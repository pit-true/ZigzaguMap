import {
  CfruProject,
  CommandBus,
  EventLabelProject,
  OverworldSprites,
  RegionMapProject,
  RomEraseProject,
  Rom,
  ScriptsTableProject,
  SpeciesNameTable,
  StampLibrary,
  createDefaultRegistry,
  detectGame,
  eventLabelCountsOf,
  eventPositionsOf,
  withRegionMap,
  withRomErase,
  withEventLabels,
  withScriptsTable,
  type CommandRegistry,
  type EventLabelSavePlan,
  type EventLabelTrackHooks,
  type EventPositions,
  type MapDocument,
  type MapId,
  type SaveResult,
  type TilesetRef,
} from "@zigzagumap/core";
import { readFile } from "./FileDialogs";
import { MapCatalog } from "./MapCatalog";
import { TauriProjectFs } from "./TauriProjectFs";
import { TilesetView } from "./TilesetView";
import { jaScriptLink } from "../i18n/ja.scriptLink";

/** 開いているマップ。 */
export interface OpenMap {
  readonly id: MapId;
  readonly doc: MapDocument;
  readonly tiles: TilesetView;
}

/** 対応していない ROM（ゲームコードが BPRJ でない、小さすぎる）。 */
export class UnknownRomError extends Error {}

/** 同時に持っておくタイルセットの組の数（メモリを抑えるため古いものから捨てる）。 */
const TILESET_CACHE_SIZE = 2;

/**
 * 開いている ROM（とプロジェクトフォルダ）。マップの読み込み、タイルセットのキャッシュ、操作の履歴、出力を受け持つ。
 * 素の ROM だけのときはフォルダが無く、出力のときにフォルダを決める。
 */
export class ProjectSession {
  readonly bus: CommandBus;
  readonly registry: CommandRegistry = createDefaultRegistry();
  private readonly tilesets = new Map<string, TilesetView>();
  private readonly opened = new Map<string, MapId>();
  private species: SpeciesNameTable | null | undefined;
  private sprites: OverworldSprites | null | undefined;
  /** タウンマップ（ワールドマップエディターを開いたときに読む）。 */
  private regionMapValue: RegionMapProject | null = null;
  /** スタンプの一覧（#239。初めて使うときに maps\stamps\ を読む）。 */
  private stampsValue: Promise<StampLibrary> | null = null;

  private constructor(
    readonly romPath: string,
    private readonly fs: TauriProjectFs,
    readonly project: CfruProject,
    private catalogValue: MapCatalog,
    /** 開くのにかかった時間（ミリ秒）。 */
    readonly loadMs: number,
    /** maps\scripts.json の対応表（開いたときに読む。小さなファイル 1 つだけ）。 */
    readonly scriptsTable: ScriptsTableProject,
    /** イベントのラベル（eventscripts と maps\BB\scripts_MM.json。開いたときに読む）。 */
    readonly labels: EventLabelProject,
    /** ビルドで 0xFF で埋める ROM の範囲（maps\rom_erase.json。#220。開いたときに読む）。 */
    readonly romErase: RomEraseProject,
  ) {
    const context = withRomErase(
      withRegionMap(project.editorContext(), () => this.requireRegionMap().document),
      () => this.requireRomErase(),
    );
    this.bus = new CommandBus(
      withEventLabels(
        withScriptsTable(context, () => this.requireScriptsTable().document),
        () => this.requireLabels(),
        (bank, map) => this.eventPositions(bank, map) ?? eventPositionsOf(null),
      ),
    );
    // ラベルの番号の付け直しは、画面の描き直しより先に済ませる（最初に購読する）
    labels.track(this.bus, {
      counts: (id) => {
        const doc = this.project.loaded(id);
        return doc ? eventLabelCountsOf(doc.events) : null;
      },
      added: (events, command) => this.labelHooks?.added?.(events, command),
      undone: (command) => this.labelHooks?.undone?.(command),
    });
  }

  /** イベントを置いたときのひな形（App が入れる）。 */
  labelHooks: Pick<EventLabelTrackHooks, "added" | "undone"> | null = null;

  /** ROM と（あれば）プロジェクトフォルダを開く。 */
  static async open(romPath: string, projectDir: string | null, romBytes?: Uint8Array): Promise<ProjectSession> {
    const start = performance.now();
    // フォルダの許可を切り替える前に、ROM の種類を確かめる（開いているものを壊さないため）。
    const bytes = romBytes ?? (await ProjectSession.readRom(romPath));
    const fs = new TauriProjectFs();
    await fs.setRoot(projectDir);
    const project = await CfruProject.open(bytes, fs);
    const catalog = await MapCatalog.build(project);
    const scripts = await ScriptsTableProject.open(fs.root ? fs : null);
    const labels = await EventLabelProject.open(fs.root ? fs : null);
    const romErase = await RomEraseProject.open(fs.root ? fs : null);
    return new ProjectSession(romPath, fs, project, catalog, performance.now() - start, scripts, labels, romErase);
  }

  /** ROM を読み、対応している ROM か確かめる（違えば UnknownRomError）。読んだバイト列は `open` に渡せる。 */
  static async readRom(romPath: string): Promise<Uint8Array> {
    const bytes = await readFile(romPath);
    let supported = false;
    try {
      supported = detectGame(new Rom(bytes)).offsets !== null;
    } catch {
      supported = false;
    }
    if (!supported) throw new UnknownRomError(romPath);
    return bytes;
  }

  /** マップ一覧用の情報。 */
  get catalog(): MapCatalog {
    return this.catalogValue;
  }

  /** マップ一覧用の情報を作り直す（マップを加えた・取り消したとき）。 */
  async refreshCatalog(): Promise<MapCatalog> {
    this.catalogValue = await MapCatalog.build(this.project);
    return this.catalogValue;
  }

  /** プロジェクトフォルダ（素の ROM だけなら null）。 */
  get projectDir(): string | null {
    return this.fs.root;
  }

  /** マップを読み、描画の準備をする。タイルセットの組は使い回す。 */
  async openMap(id: MapId): Promise<OpenMap> {
    const doc = await this.project.load(id);
    const key = `${doc.primaryTileset >>> 0}:${doc.secondaryTileset >>> 0}`;
    let tiles = this.tilesets.get(key);
    if (tiles) {
      this.tilesets.delete(key);
    } else {
      const { primary, secondary } = await this.project.loadTilesets(doc);
      tiles = new TilesetView(key, primary, secondary);
    }
    this.tilesets.set(key, tiles);
    while (this.tilesets.size > TILESET_CACHE_SIZE) this.tilesets.delete(this.tilesets.keys().next().value!);
    this.opened.set(mapKey(id), id);
    this.labels.observe(id, eventLabelCountsOf(doc.events), this.eventPositions(id.bank, id.map) ?? undefined);
    return { id, doc, tiles };
  }

  /** 持っているタイルセットの組（無ければ undefined。持っている順は変えない。隣のマップの帯の描画用）。 */
  cachedTiles(key: string): TilesetView | undefined {
    return this.tilesets.get(key);
  }

  /** 種族名表（初めて使うときに読む。読めなければ null）。 */
  get speciesNames(): SpeciesNameTable | null {
    if (this.species === undefined) {
      try {
        this.species = SpeciesNameTable.read(this.project.rom, this.project.game.offsets.speciesNameTablePointer);
      } catch {
        this.species = null;
      }
    }
    return this.species;
  }

  /** OW の画像（初めて使うときに読む。読めなければ null）。 */
  get overworldSprites(): OverworldSprites | null {
    if (this.sprites === undefined) {
      const o = this.project.game.offsets;
      try {
        this.sprites = OverworldSprites.read(this.project.rom, o.overworldGraphicsTablePointer, o.overworldPaletteTablePointer);
      } catch {
        this.sprites = null;
      }
    }
    return this.sprites;
  }

  /** タウンマップを読む（2 回目以降は同じものを返す）。maps\regionmap.json があれば重ねる。 */
  async openRegionMap(): Promise<RegionMapProject> {
    this.regionMapValue ??= await RegionMapProject.open(
      this.project.rom,
      this.project.game.code,
      this.fs.root ? this.fs : null,
      this.project.editorContext().flyPositions,
    );
    return this.regionMapValue;
  }

  /** 読み込み済みのタウンマップ（まだなら null）。 */
  get regionMap(): RegionMapProject | null {
    return this.regionMapValue;
  }

  private requireRegionMap(): RegionMapProject {
    if (!this.regionMapValue) throw new Error("ワールドマップエディタを開いてから実行してください");
    return this.regionMapValue;
  }

  private requireLabels() {
    if (!this.fs.root) throw new Error(jaScriptLink.labelsNeedProject);
    return this.labels.store;
  }

  /** 読み込み済みのマップのイベントの座標（ラベルの照合用）。読み込んでいなければ null。 */
  eventPositions(bank: number, map: number): EventPositions | null {
    const doc = this.project.loaded({ bank, map });
    return doc ? eventPositionsOf(doc.events) : null;
  }

  private requireRomErase(): RomEraseProject {
    if (!this.fs.root) throw new Error(jaScriptLink.labelsNeedProject);
    return this.romErase;
  }

  private requireScriptsTable(): ScriptsTableProject {
    const error = this.scriptsTable.loadError;
    if (error !== null) throw new Error(jaScriptLink.scriptsJsonBroken(error));
    return this.scriptsTable;
  }

  /** プロジェクトフォルダのファイルがあるか（フォルダが無ければ false）。 */
  async fileExists(path: string): Promise<boolean> {
    return this.fs.root !== null && (await this.fs.exists(path));
  }

  /** そのマップが読み込み済みか。 */
  isLoaded(id: MapId): boolean {
    return this.project.loaded(id) !== undefined;
  }

  /** 未出力の変更があるか。 */
  isModified(id: MapId): boolean {
    return this.project.isModified(id);
  }

  /** 未出力の変更があるか（マップ・タイルセット・マップ名・scripts.json の対応表）。 */
  hasUnsavedChanges(): boolean {
    return this.project.hasUnsavedChanges() || this.scriptsTable.isModified() || this.labels.isModified() || this.romErase.isModified();
  }

  /**
   * タイルセットを編集したあと、それを使う組（キャッシュにあるもの）を作り直す。作り直した組を返す。
   * 組のキーは「主のポインタ値:副のポインタ値」。
   */
  refreshTilesets(ref: TilesetRef): TilesetView[] {
    const context = this.project.editorContext();
    const out: TilesetView[] = [];
    for (const view of this.tilesets.values()) {
      const [primary, secondary] = view.key.split(":").map(Number) as [number, number];
      if ((ref.secondary ? secondary : primary) !== ref.pointer >>> 0) continue;
      view.reload(
        context.tileset({ pointer: primary, secondary: false }).toTileset(),
        context.tileset({ pointer: secondary, secondary: true }).toTileset(),
      );
      out.push(view);
    }
    return out;
  }

  /** タウンマップに未出力の変更があるか。 */
  isRegionMapModified(): boolean {
    return this.regionMapValue?.isModified() ?? this.project.isFlyPositionsModified();
  }

  /** 未出力の変更があるマップ（バンク・マップの順）。 */
  modifiedMaps(): MapId[] {
    // 開いたマップと、読み込み済みのマップ（追加・差し替えたもの、開かずに足したバンクも含む）。
    const ids = new Map(this.opened);
    for (const id of this.project.mapIds()) if (this.project.loaded(id)) ids.set(mapKey(id), id);
    return [...ids.values()].filter((id) => this.project.isModified(id)).sort((a, b) => a.bank - b.bank || a.map - b.map);
  }

  /**
   * 変更のあったマップを maps\BB\MM.json へ書く。`dir` を渡すとそのフォルダへ書く（以後そこをプロジェクトフォルダにする）。
   * フォルダが決まっていなければ Error。
   */
  async export(dir?: string): Promise<SaveResult> {
    if (dir !== undefined) await this.fs.setRoot(dir);
    if (!this.fs.root) throw new Error("出力先のフォルダが決まっていません");
    const result = await this.project.save();
    const parts = [result];
    // フライトポジションは maps\regionmap.json の HealLocations に書くので、タウンマップを開いていなくても読んで書く。
    if (this.regionMapValue || this.project.isFlyPositionsModified()) {
      parts.push(await (await this.openRegionMap()).save(this.fs));
      this.project.markFlyPositionsSaved();
    }
    // scripts.json と、対応表で新しく作った .s・.string（既にあるファイルは書き換えない）。
    parts.push(await this.scriptsTable.save(this.fs));
    // イベントのラベル（maps\BB\scripts_MM.json と eventscripts）と、.s のマップスクリプトの表。
    const labels = await this.labels.save(this.fs, (bank, map) => this.eventPositions(bank, map));
    parts.push(labels);
    if (labels.plan.tables.length > 0 && this.writeTables) parts.push(await this.writeTables(labels.plan.tables));
    // ビルドで 0xFF で埋める範囲（maps\rom_erase.json。イベントの削除 #220）
    parts.push(await this.romErase.save(this.fs));
    // スタンプ（#239）: 出力先を選んだとき（素の ROM だけで開いていた・別のフォルダへ出力した）は、今のスタンプをその先へ書く
    if (dir !== undefined && this.stampsValue) parts.push({ written: await (await this.stampsValue).relocate(this.fs), removed: [] });
    return { written: parts.flatMap((p) => p.written), removed: parts.flatMap((p) => p.removed) };
  }

  /** 出力のときに .s のマップスクリプトの表を書き直す（App が入れる。エディタで開いていればエディタの本文を書き換える）。 */
  writeTables: ((tables: EventLabelSavePlan["tables"]) => Promise<{ written: string[]; removed: string[] }>) | null = null;

  /**
   * スタンプの一覧（#239）。初めて使うときに maps\stamps\ を読む。保存・名前の変更・削除はすぐファイルに書く
   * （書く前に maps\project.json が無ければ作る）。素の ROM だけで開いているときはメモリに持ち、出力先を選んだときに書く。
   */
  stamps(): Promise<StampLibrary> {
    const opened = (this.stampsValue ??= StampLibrary.open(this.fs.root ? this.fs : null, { beforeWrite: () => this.project.ensureManifest() }));
    opened.catch(() => {
      if (this.stampsValue === opened) this.stampsValue = null;
    });
    return opened;
  }

  /** プロジェクトフォルダのファイルの読み書き（ひな形を書くときなど）。 */
  get files(): TauriProjectFs {
    return this.fs;
  }

  /** 別のものを開くのに失敗したあと、Rust 側のフォルダの許可をこのセッションのものに戻す。 */
  async reattach(): Promise<void> {
    await this.fs.setRoot(this.fs.root);
  }

  /** 閉じる（Rust 側のフォルダの許可も外す）。 */
  async close(): Promise<void> {
    await this.fs.setRoot(null);
  }
}

function mapKey(id: MapId): string {
  return `${id.bank}.${id.map}`;
}
