import {
  CommandGroup,
  CreateMapCommand,
  CreateWorkMapCommand,
  InsertMapCommand,
  OpenMapFileCommand,
  ROM_BASE,
  ReplaceMapCommand,
  WORK_MAP_BANK,
  encodeBase64,
  isWorkMapId,
  toAmMapFiles,
  type Command,
  type MapId,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { fileExists, fileNameOf, folderOf, readFile as readBytes, writeFile, type FileDialogs } from "../../app/FileDialogs";
import { mapLabel } from "../../app/MapTreeModel";
import type { ProjectSession } from "../../app/ProjectSession";
import type { MapFileEntry } from "../../app/Settings";
import { ja } from "../../i18n/ja";
import { jaNewMap } from "../../i18n/ja.newMap";
import { showError } from "../MessageBox";
import { openBankHeaderDialog, type BankRow } from "./BankHeaderDialog";
import { openMapInsertDialog } from "./MapInsertDialog";
import { openNewMapDialog } from "./NewMapDialog";
import { showNewMapError } from "./newMapErrors";

/** NewMapController が使う App の窓口。 */
export interface NewMapHost {
  readonly state: EditorState;
  readonly files: FileDialogs;
  /** マップを開いて表示する。 */
  openMap(id: MapId): Promise<void>;
  /** マップ一覧を作り直す（マップを加えたあと）。 */
  refreshMapList(): Promise<void>;
  /** 「ZigzaguMap は ROM へ書き込まないため、この機能は不要です」。 */
  notNeeded(): Promise<unknown>;
}

/** ファイル名に使えない文字（AdvanceMap は「建物/施設」のような名前で保存ダイアログを開けないので、ZigzaguMap は _ に置き換える）。 */
const INVALID_FILE_CHARS = /[\\/:*?"<>|]/g;

/**
 * ファイル > マップ の 4 項目（新規マップの作成、作成したマップを開く、名前をつけて作成したマップを保存、マップの追加/挿入）と、
 * ツール > ダミーデータへ移す/ヘッダー管理 > マップバンクヘッダーの管理、マップタブの「新規マップ作成」「マップバンクの作成」。
 *
 * 新規作成と `.map` から開いたマップは作業用のマップ（バンク -1）になり、プロジェクトには入らない（出力もしない）。
 * マップの追加/挿入でプロジェクトのマップへ写す。編集はすべて CommandBus を通すので、作成・追加も Ctrl+Z で取り消せる。
 */
export class NewMapController {
  constructor(private readonly host: NewMapHost) {}

  private get state(): EditorState {
    return this.host.state;
  }

  private session(): ProjectSession | null {
    return this.state.session;
  }

  /** 今のマップの名前（一覧の項目の文字列。作業用のマップは作成・読み込みしたときの名前）。 */
  currentName(): string {
    const session = this.session();
    const map = this.state.map;
    if (!session || !map) return "";
    if (isWorkMapId(map.id)) return session.project.workMapInfo(map.id)?.name ?? "";
    const info = session.catalog.get(map.id);
    return info ? mapLabel(info, this.state.settings.data.sortMode) : ja.mapItem(ja.noName, "", map.id.bank, map.id.map);
  }

  /**
   * ファイル > マップ > 新規マップの作成（ツールバーの「新規マップの作成」、マップタブの「新規マップ作成」）。
   * 初期値は今のマップの名前と大きさ。作成すると作業用のマップを開く（題名・一覧の選択は変えない。AdvanceMap と同じ）。
   */
  async newMap(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const current = this.state.map;
    const ctx = session.project.editorContext();
    const table = session.project.tilesetTable;
    const map = ctx.nextWorkMapNumber();
    const created = await openNewMapDialog({
      name: this.currentName(),
      width: current?.doc.width ?? 1,
      height: current?.doc.height ?? 1,
      tilesetCount: table.count,
      create: (input) => {
        const pointer = (n: number | null): number | null => (n === null ? null : table.pointerOf(n));
        session.bus.execute(
          new CreateWorkMapCommand({
            map,
            name: input.name,
            width: input.width,
            height: input.height,
            primaryTileset: pointer(input.tileset1),
            secondaryTileset: pointer(input.tileset2),
            ...(current ? { templateBank: current.id.bank, templateMap: current.id.map } : {}),
          }),
        );
      },
    });
    if (created) await this.host.openMap({ bank: WORK_MAP_BANK, map });
  }

  /** ファイル > マップ > 作成したマップを開く。 */
  async openFile(): Promise<void> {
    if (!this.session()) return;
    const path = await this.host.files.openFile({
      title: jaNewMap.openTitle,
      filters: [{ name: jaNewMap.fileFilter, extensions: ["map"] }],
      directory: this.initialDir(),
    });
    if (path) await this.load(path, baseName(path));
  }

  /** マップ一覧の「マップファイル」の項目を開く。ファイルが無ければ AdvanceMap の [Allgemein] 41 を出し、項目を外す。 */
  async openEntry(path: string, name: string): Promise<void> {
    if (!this.session()) return;
    if (!(await fileExists(path))) {
      await showError(jaNewMap.filesMissing);
      const s = this.state.settings;
      s.update({ mapFiles: s.data.mapFiles.filter((f) => f.path.toLowerCase() !== path.toLowerCase()) });
      await this.host.refreshMapList();
      return;
    }
    await this.load(path, name);
  }

  /** `.map` と同じ名前の `.evt`（無ければイベント無し）を読んで、作業用のマップとして開く。 */
  private async load(path: string, name: string): Promise<void> {
    const session = this.session();
    if (!session) return;
    try {
      const data = await readBytes(path);
      const evtPath = path.replace(/\.[^.\\/]*$/, "") + ".evt";
      const events = (await fileExists(evtPath)) ? await readBytes(evtPath) : null;
      const current = this.state.map;
      const map = session.project.editorContext().nextWorkMapNumber();
      session.bus.execute(
        new OpenMapFileCommand({
          map,
          name,
          path,
          data: encodeBase64(data),
          ...(events ? { events: encodeBase64(events) } : {}),
          ...(current ? { templateBank: current.id.bank, templateMap: current.id.map } : {}),
        }),
      );
      this.state.settings.update({ mapFileDir: folderOf(path) });
      await this.host.openMap({ bank: WORK_MAP_BANK, map });
    } catch (e) {
      await showNewMapError(e);
    }
  }

  /**
   * ファイル > マップ > 名前をつけて作成したマップを保存。今のマップ（作業用でもプロジェクトのマップでも）を `.map` と `.evt` に書き、
   * マップ一覧の「マップファイル」に名前とパスを登録する（同じ名前の項目はパスを書き換える）。
   */
  async saveAs(): Promise<void> {
    const session = this.session();
    const map = this.state.map;
    if (!session || !map) return;
    const name = this.currentName();
    const path = await this.host.files.saveFile({
      title: jaNewMap.saveTitle,
      filters: [{ name: jaNewMap.fileFilter, extensions: ["map"] }],
      directory: this.initialDir(),
      fileName: `${name.replace(INVALID_FILE_CHARS, "_")}.map`,
    });
    if (!path) return;
    const mapPath = /\.map$/i.test(path) ? path : `${path}.map`;
    const ctx = session.project.editorContext();
    try {
      const files = toAmMapFiles(map.doc, (pointer) => ctx.tilesetIndex(pointer));
      await writeFile(mapPath, files.map);
      await writeFile(mapPath.replace(/\.map$/i, ".evt"), files.events);
    } catch (e) {
      await showNewMapError(e);
      return;
    }
    if (isWorkMapId(map.id)) ctx.setWorkMapInfo(map.id, { name, path: mapPath });
    const s = this.state.settings;
    const entry: MapFileEntry = { name, path: mapPath };
    const index = s.data.mapFiles.findIndex((f) => f.name === name);
    const mapFiles = index < 0 ? [...s.data.mapFiles, entry] : s.data.mapFiles.map((f, i) => (i === index ? entry : f));
    s.update({ mapFiles, mapFileDir: folderOf(mapPath) });
    await this.host.refreshMapList();
    this.state.setStatus(jaNewMap.saved(mapPath));
  }

  /** ファイル > マップ > マップの追加/挿入（ツールバーの「マップの追加/挿入」）。 */
  async insert(): Promise<void> {
    const session = this.session();
    const map = this.state.map;
    if (!session || !map) return;
    const source = map.id;
    const info = session.project.workMapInfo(source);
    await openMapInsertDialog({
      currentText: () =>
        info ? `${jaNewMap.currentFile} ${info.path ?? info.name}` : `${jaNewMap.currentMap} ${source.bank}.${source.map}`,
      bankCounts: () => session.project.bankCounts(),
      replace: async (target) => {
        await session.project.load(target);
        session.bus.execute(new ReplaceMapCommand({ ...target, sourceBank: source.bank, sourceMap: source.map }));
        await this.host.refreshMapList();
        return target;
      },
      append: async (bank) => {
        const counts = session.project.bankCounts();
        const target = { bank, map: bank < counts.length ? counts[bank]! : 0 };
        session.bus.execute(new InsertMapCommand({ ...target, sourceBank: source.bank, sourceMap: source.map }));
        await this.host.refreshMapList();
        return target;
      },
      openMap: (id) => this.host.openMap(id),
      showBankHeader: () => this.bankHeader(),
    });
  }

  /**
   * ツール > ダミーデータへ移す/ヘッダー管理 > マップバンクヘッダーの管理（マップの追加/挿入の「マップバンクヘッダーの表示」）。
   * 「新バンク番号」で足した行は、「変更の適用」で新しいバンクとして作る（ビルド側の制約で空のバンクは作れないので、
   * 各バンクに新規マップの作成と同じ初期値のマップ 0 を 1 つ置く。全部で 1 回の操作）。
   * ダミーマップの残量・予約の欄を変えて適用したときは「…この機能は不要です」と案内する。
   */
  async bankHeader(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const project = session.project;
    const table = project.base.bankTable;
    const rows: BankRow[] = project.bankCounts().map((count, bank) => ({
      bank,
      offset: bank < table.bankCount ? listOffset(project.rom.u32(table.offset + bank * 4)) : 0,
      count,
    }));
    const changes = await openBankHeaderDialog(rows);
    if (!changes) return;
    if (changes.newBanks > 0) {
      const current = this.state.map;
      const doc = current?.doc;
      const first = rows.length;
      const commands: Command[] = Array.from({ length: changes.newBanks }, (_, i) =>
        new CreateMapCommand({
          bank: first + i,
          map: 0,
          width: doc?.width ?? null,
          height: doc?.height ?? null,
          primaryTileset: doc?.primaryTileset ?? null,
          secondaryTileset: doc?.secondaryTileset ?? null,
          ...(current ? { templateBank: current.id.bank, templateMap: current.id.map } : {}),
        }),
      );
      try {
        session.bus.execute(CommandGroup.of(commands));
      } catch (e) {
        await showNewMapError(e);
        return;
      }
      await this.host.refreshMapList();
    }
    if (changes.dummyChanged) await this.host.notNeeded();
  }

  /** マップタブの「マップバンクの作成」（AdvanceMap はダミーマップの数を聞いて ROM へ書く）。 */
  makeBank(): Promise<unknown> {
    return this.host.notNeeded();
  }

  /** `.map` のダイアログの初期フォルダ（前回のフォルダ、無ければ ROM のフォルダ）。 */
  private initialDir(): string | null {
    const s = this.state.settings.data;
    return s.mapFileDir ?? (this.session() ? folderOf(this.session()!.romPath) : null);
  }
}

/** ファイルを読む（ROM を読むのと同じ Rust のコマンド）。 */

/** 拡張子を除いたファイル名。 */
function baseName(path: string): string {
  return fileNameOf(path).replace(/\.[^.]*$/, "");
}

/** バンク表の値（ポインタ）を ROM 上の位置にする（ROM 外なら 0）。 */
function listOffset(pointer: number): number {
  const at = pointer - ROM_BASE;
  return at >= 0 && at < 0x2000000 ? at : 0;
}
