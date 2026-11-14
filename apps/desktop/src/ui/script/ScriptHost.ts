import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  RenameEventLabelCommand,
  buildScriptIndex,
  eventScriptLabel,
  isEventScriptEntryActive,
  isScriptSourcePath,
  loadEventScripts,
  loadScriptsJson,
  parseEventScriptDefines,
  reloadScriptIndexFile,
  resolveScriptsJson,
  type EventLabelStore,
  type EventScriptTarget,
  type ScriptImportPlan,
  type ScriptIndex,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import type { WindowPlacement } from "../../app/Settings";
import { TauriProjectFs } from "../../app/TauriProjectFs";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import { errorText } from "../../util/errors";
import { isEditableScriptPath, normalizeScriptPath } from "../../windows/script-editor/fileText";
import {
  SCRIPT_EDITOR_SIZE,
  SCRIPT_EDITOR_WINDOW,
  ScriptEditorEvents,
  type ScriptEditorEnvelope,
  type ScriptEditorHello,
  type ScriptEditorQuery,
  type ScriptEditorQueryEnvelope,
  type ScriptEditorReply,
  type ScriptEditorRequest,
  type ScriptOpenRequest,
  type ScriptRomOpenRequest,
} from "../../windows/script-editor/protocol";
import { RomScripts } from "./RomScripts";
import type { ScriptTarget } from "./ScriptEntry";

/** イベントのスクリプトの場所（解決の結果）。 */
export interface ScriptLocation {
  readonly path: string;
  /** 行（1 から）。 */
  readonly line: number;
  /** eventscripts で見つけたラベル（無ければ null）。 */
  readonly label: string | null;
  /** どこから求めたか（`label`: ラベルの定義、`scriptsJson`: マップの .s の先頭）。 */
  readonly from: "label" | "scriptsJson";
}

/** `tool-placement` の中身。 */
interface PlacementEvent extends WindowPlacement {
  readonly label: string;
}

/** 問い合わせの答えを待つ時間（ms）。 */
const QUERY_TIMEOUT_MS = 10_000;

const TARGET_OF: Readonly<Record<ScriptTarget["kind"], EventScriptTarget>> = { person: "person", sign: "sign", trap: "tile", map: "map" };

/**
 * メインウィンドウ側の、スクリプトエディタ（別ウィンドウ）の窓口。初めてスクリプトを開くときに読み込む（メインの起動では読まない）。
 *
 * - イベント（マップ・種別・番号）→ eventscripts のラベル → ラベルの索引（ScriptIndex）で `.s` と行を求める。
 *   ラベルが見つからなければ maps\scripts.json のマップの `.s` の先頭を開く。
 * - ウィンドウは大きさを変えられ、位置と大きさを個人設定の `toolWindows` に覚える。
 * - ラベルの索引はメインが持つ（名前・ファイル・行だけ）。初めて使うときに作り、エディタで保存したファイルの分だけ読み直す。
 *   メインウィンドウが前面に戻ったとき（外のエディタで書き換えたかもしれない）は捨て、次に使うときに作り直す。
 */
export class ScriptHost {
  private static current: Promise<ScriptHost> | null = null;

  /** 窓口（初めて呼ばれたときに作る）。 */
  static get(app: App): Promise<ScriptHost> {
    return (ScriptHost.current ??= (async () => {
      const host = new ScriptHost(app);
      await host.start();
      return host;
    })());
  }

  private readonly fs = new TauriProjectFs();
  /** ウィンドウを開いている（開こうとしている）。 */
  private opened = false;
  /** ウィンドウの準備ができた（`hello` が届いた）。 */
  private ready = false;
  /** 準備ができる前に頼まれたファイル。 */
  private pending: ScriptOpenRequest[] = [];
  /** 準備ができる前に頼まれたビルド。 */
  private pendingBuild = false;
  /** 準備ができる前に頼まれた ROM のスクリプト。 */
  private pendingRoms: ScriptRomOpenRequest[] = [];
  private readonly roms: RomScripts;
  /** ウィンドウを開いたときのプロジェクトフォルダ（変わったら閉じる）。 */
  private projectDir: string | null = null;
  private index: Promise<ScriptIndex> | null = null;
  private nextQueryId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private readonly app: App) {
    this.roms = new RomScripts(app);
  }

  private async start(): Promise<void> {
    await listen<ScriptEditorEnvelope>(ScriptEditorEvents.request, (e) => void this.onRequest(e.payload));
    await listen<ScriptEditorReply>(ScriptEditorEvents.answer, (e) => {
      const w = this.waiting.get(e.payload.id);
      if (!w) return;
      this.waiting.delete(e.payload.id);
      if (e.payload.ok) w.resolve(e.payload.result);
      else w.reject(new Error(e.payload.error));
    });
    await listen<string>("tool-closed", (e) => {
      if (e.payload !== SCRIPT_EDITOR_WINDOW) return;
      this.opened = false;
      this.ready = false;
      this.pending = [];
      this.pendingRoms = [];
      this.pendingBuild = false;
      for (const w of this.waiting.values()) w.reject(new Error("closed"));
      this.waiting.clear();
    });
    await listen<PlacementEvent>("tool-placement", (e) => {
      const { label, ...placement } = e.payload;
      if (label !== SCRIPT_EDITOR_WINDOW) return;
      const settings = this.app.state.settings;
      settings.update({ toolWindows: { ...settings.data.toolWindows, [label]: placement } });
    });
    await getCurrentWindow().listen("tauri://focus", () => (this.index = null));
    this.app.state.on("session", () => this.sessionChanged());
  }

  /** エディタのウィンドウが開いているか。 */
  get isOpen(): boolean {
    return this.opened;
  }

  // ---- 開く ----

  /** ファイルを開く（行は 1 から）。開けないパスならステータスバーに出して false。 */
  async openFile(rawPath: string, line?: number): Promise<boolean> {
    const session = this.app.state.session;
    if (!session?.projectDir) {
      this.app.state.setStatus(t.noProject);
      return false;
    }
    const path = normalizeScriptPath(rawPath);
    if (!isEditableScriptPath(path)) {
      this.app.state.setStatus(t.notEditable(rawPath));
      return false;
    }
    const request: ScriptOpenRequest = line === undefined ? { path } : { path, line };
    if (this.ready) await emitTo(SCRIPT_EDITOR_WINDOW, ScriptEditorEvents.open, request);
    else this.pending.push(request);
    await this.openWindow();
    return true;
  }

  /**
   * イベントのスクリプトを開く。ラベルが見つからず `pointer` が ROM を指していれば、ROM のスクリプトを読み取り専用で出す。
   * どちらも無ければステータスバーに出して null。
   */
  async openTarget(target: ScriptTarget, pointer: number | null = null): Promise<ScriptLocation | null> {
    const romPointer = pointer !== null && pointer >>> 24 >= 0x08 && pointer >>> 24 <= 0x09 ? pointer : null;
    if (!this.app.state.session?.projectDir || (romPointer !== null && this.labelOf(target) === null)) {
      if (romPointer !== null) await this.openRom(romPointer, target);
      else this.app.state.setStatus(this.app.state.session?.projectDir ? t.notFound : t.noProject);
      return null;
    }
    let location: ScriptLocation | null;
    try {
      location = await this.resolve(target);
    } catch (e) {
      this.app.state.setStatus(errorText(e), undefined, true);
      return null;
    }
    if (!location) {
      this.app.state.setStatus(t.notFound);
      return null;
    }
    if (!(await this.openFile(location.path, location.line))) return null;
    this.app.state.setStatus(location.label && location.from === "scriptsJson" ? t.labelNotFound(location.label) : t.opened(location.path, location.line));
    return location;
  }

  /** ビルドする（ツール > ビルド）。エディタのウィンドウを開き、下のビルドの欄で動かす。 */
  async build(): Promise<void> {
    if (!this.app.state.session?.projectDir) {
      this.app.state.setStatus(t.noProject);
      return;
    }
    if (this.ready) await emitTo(SCRIPT_EDITOR_WINDOW, ScriptEditorEvents.build, null);
    else this.pendingBuild = true;
    await this.openWindow();
  }

  /**
   * イベントのスクリプトの場所を求める。eventscripts の行（`#ifdef` で複数あれば、条件が成り立つもの）のラベルを
   * 索引で引き、見つからなければ scripts.json のマップの `.s` の 1 行目。どちらも無ければ null。
   */
  async resolve(target: ScriptTarget): Promise<ScriptLocation | null> {
    if (!this.app.state.session?.projectDir) throw new Error(t.noProject);
    const { bank, map } = target.map;
    // ZigzaguMap のラベル（scripts_MM.json か eventscripts の #ifdef の外の行。編集中の値）を先に使う
    let label = this.labelOf(target);
    if (label === null) {
      const scripts = await loadEventScripts(this.fs);
      const defines = new Map<string, string | true>();
      for (const include of scripts.includes()) {
        try {
          parseEventScriptDefines(await this.fs.readText(include), defines);
        } catch {
          // 読めない #include は飛ばす（insert.py もビルドの前に止まる）
        }
      }
      const entries = scripts.entriesFor(bank, map, TARGET_OF[target.kind], target.kind === "map" ? undefined : (target.index ?? 0));
      const entry = entries.find((e) => isEventScriptEntryActive(e, defines)) ?? entries[0];
      label = entry ? eventScriptLabel(entry.kind, entry.symbol, defines) : null;
    }
    if (label) {
      const found = (await this.scriptIndex()).findLabel(label);
      if (found && isEditableScriptPath(found.path)) return { path: found.path, line: found.line, label, from: "label" };
    }
    const json = await loadScriptsJson(this.fs);
    const resolved = json ? resolveScriptsJson(json, bank, map) : null;
    if (resolved && isEditableScriptPath(resolved.script)) return { path: normalizeScriptPath(resolved.script), line: 1, label, from: "scriptsJson" };
    return null;
  }

  /** ROM のスクリプトを読み取り専用で出す（#206）。プロジェクトが無く ROM だけでも出せる。 */
  async openRom(pointer: number, target: ScriptTarget | null): Promise<ScriptRomOpenRequest | null> {
    let request: ScriptRomOpenRequest;
    try {
      request = await this.roms.view(pointer, target);
    } catch (e) {
      this.app.state.setStatus(errorText(e), undefined, true);
      return null;
    }
    if (this.ready) await emitTo(SCRIPT_EDITOR_WINDOW, ScriptEditorEvents.openRom, request);
    else this.pendingRoms.push(request);
    await this.openWindow();
    this.app.state.setStatus(t.romOpened(request.key));
    return request;
  }

  /** ROM のスクリプトを .s に取り込む（#207）。 */
  importRom(pointer: number, target: ScriptTarget, rename: ReadonlyMap<string, string> = new Map()): Promise<ScriptImportPlan> {
    return this.roms.import(pointer, target, rename);
  }

  /** ラベルの定義を開く（索引で引く）。見つからなければステータスバーに出して false。 */
  async openLabel(label: string): Promise<boolean> {
    const found = (await this.scriptIndex()).findLabel(label);
    if (!found || !isEditableScriptPath(found.path)) {
      this.app.state.setStatus(t.labelMissing(label));
      return false;
    }
    return this.openFile(found.path, found.line);
  }

  /** プロジェクトのラベルの名前（索引から）。 */
  async labelNames(): Promise<string[]> {
    return (await this.scriptIndex()).labelNames();
  }

  /**
   * エディタでラベル名を変えた（#203）。そのラベルを使うイベントかマップスクリプトがあれば、eventscripts とイベントの側を変える
   * コマンド（元に戻せる）を実行する。変えた数を返す。
   */
  labelRenamed(from: string, to: string): number {
    const session = this.app.state.session;
    if (!session || from === to) return 0;
    const uses = session.labels.store.usesOf(from).length + tableUses(session.labels.store, from);
    if (uses === 0) return 0;
    if (this.app.scripts.execute(new RenameEventLabelCommand({ from, to }))) this.app.state.setStatus(t.labelRenamed(from, to, uses));
    return uses;
  }

  // ---- メインからの書き換え ----

  /** エディタで開いているファイルの本文（開いていなければ null）。 */
  async bufferText(path: string): Promise<string | null> {
    if (!this.ready) return null;
    return (await this.query({ type: "bufferText", path: normalizeScriptPath(path) })) as string | null;
  }

  /** エディタで開いているファイルの本文を書き換える（開いていなければ false）。 */
  async setBufferText(path: string, text: string, save: boolean): Promise<boolean> {
    if (!this.ready) return false;
    const ok = (await this.query({ type: "setBufferText", path: normalizeScriptPath(path), text, save })) === true;
    if (ok && save) await this.fileChanged(path);
    return ok;
  }

  /** メインがディスクのファイルを書き換えた（ラベルの索引のそのファイルの分を読み直す）。 */
  async fileChanged(rawPath: string): Promise<void> {
    const path = normalizeScriptPath(rawPath);
    if (this.index && isScriptSourcePath(path)) await reloadScriptIndexFile(await this.index, this.fs, path);
  }

  /** 編集中のラベル（ZigzaguMap のラベルの持ち方で付いているもの）。無ければ null。 */
  labelOf(target: ScriptTarget): string | null {
    const store = this.app.state.session?.labels.store;
    if (!store) return null;
    const { bank, map } = target.map;
    if (target.kind === "map") return store.get(bank, map).mapScripts;
    return store.label(bank, map, TARGET_OF[target.kind] as "person" | "sign" | "tile", target.index ?? 0)?.label ?? null;
  }

  // ---- 閉じる・未保存の確認 ----

  /** エディタの未保存のファイル（開いていなければ空）。 */
  async dirtyFiles(): Promise<string[]> {
    if (!this.ready) return [];
    return (await this.query({ type: "dirty" })) as string[];
  }

  /** エディタの未保存のファイルを全部保存する。 */
  async saveAll(): Promise<boolean> {
    if (!this.ready) return true;
    return (await this.query({ type: "saveAll" })) === true;
  }

  /** エディタを閉じる（確かめない。未保存の確認は App が先に済ませる）。 */
  close(): void {
    if (!this.opened) return;
    void invoke("close_tool_window", { label: SCRIPT_EDITOR_WINDOW });
  }

  // ---- 内部 ----

  private async openWindow(): Promise<void> {
    const wasOpen = this.opened;
    this.opened = true;
    if (!wasOpen) this.projectDir = this.app.state.session?.projectDir ?? null;
    const placement = this.app.state.settings.data.toolWindows[SCRIPT_EDITOR_WINDOW] ?? null;
    try {
      await invoke("open_tool_window", {
        label: SCRIPT_EDITOR_WINDOW,
        title: t.title,
        width: SCRIPT_EDITOR_SIZE.width,
        height: SCRIPT_EDITOR_SIZE.height,
        resize: { minWidth: SCRIPT_EDITOR_SIZE.minWidth, minHeight: SCRIPT_EDITOR_SIZE.minHeight, placement, remember: true },
      });
    } catch (e) {
      if (!wasOpen) this.opened = false;
      throw e;
    }
  }

  private sessionChanged(): void {
    this.index = null;
    // 別のプロジェクトフォルダを開いたら閉じる（相対パスが別のフォルダを指すため）。同じフォルダの開き直しなら残す
    const dir = this.app.state.session?.projectDir ?? null;
    if (this.opened && !samePath(dir, this.projectDir)) this.close();
  }

  private scriptIndex(): Promise<ScriptIndex> {
    const building = (this.index ??= buildScriptIndex(this.fs));
    building.catch(() => {
      if (this.index === building) this.index = null;
    });
    return building;
  }

  private async onRequest(envelope: ScriptEditorEnvelope): Promise<void> {
    let reply: ScriptEditorReply;
    try {
      reply = { id: envelope.id, ok: true, result: (await this.handle(envelope.request)) ?? null };
    } catch (e) {
      reply = { id: envelope.id, ok: false, error: errorText(e) };
    }
    await emitTo(SCRIPT_EDITOR_WINDOW, ScriptEditorEvents.reply, reply).catch(() => undefined);
  }

  private async handle(request: ScriptEditorRequest): Promise<unknown> {
    switch (request.type) {
      case "hello": {
        this.ready = true;
        this.opened = true;
        const hello: ScriptEditorHello = { opens: this.pending, roms: this.pendingRoms, projectDir: this.app.state.session?.projectDir ?? null, build: this.pendingBuild };
        this.pending = [];
        this.pendingRoms = [];
        this.pendingBuild = false;
        return hello;
      }
      case "saved": {
        const path = normalizeScriptPath(request.path);
        if (this.index && isScriptSourcePath(path)) await reloadScriptIndexFile(await this.index, this.fs, path);
        this.app.scripts.files.forget(path);
        return null;
      }
      case "mainDirty": {
        const session = this.app.state.session;
        if (!session) return 0;
        const maps = session.modifiedMaps().length;
        return maps + (maps === 0 && (session.hasUnsavedChanges() || session.isRegionMapModified()) ? 1 : 0);
      }
      case "exportMain":
        return this.app.exportMaps(false);
      case "importRom":
        return this.importRom(request.pointer, request.target, new Map(Object.entries(request.rename)));
      case "labelRenamed":
        return this.labelRenamed(request.from, request.to);
      case "labelUses": {
        const store = this.app.state.session?.labels.store;
        return store ? store.usesOf(request.label).length + tableUses(store, request.label) : 0;
      }
      case "setting":
        this.app.state.settings.update({ [request.key]: request.value });
        return null;
    }
  }

  private query(query: ScriptEditorQuery): Promise<unknown> {
    const id = this.nextQueryId++;
    const envelope: ScriptEditorQueryEnvelope = { id, query };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(t.noReply));
      }, QUERY_TIMEOUT_MS);
      const done = (fn: () => void): void => {
        clearTimeout(timer);
        fn();
      };
      this.waiting.set(id, { resolve: (v) => done(() => resolve(v)), reject: (e) => done(() => reject(e)) });
      emitTo(SCRIPT_EDITOR_WINDOW, ScriptEditorEvents.query, envelope).catch((e: unknown) => {
        this.waiting.delete(id);
        done(() => reject(e instanceof Error ? e : new Error(String(e))));
      });
    });
  }
}

/** マップスクリプトの表の行き先にそのラベルがある数。 */
function tableUses(store: EventLabelStore, label: string): number {
  let n = 0;
  for (const { bank, map } of store.tableMaps()) {
    const table = store.get(bank, map).table;
    for (const i of table?.items ?? []) {
      if (i.script === label) n++;
      for (const c of i.conditions) if (c.script === label) n++;
    }
  }
  return n;
}

/** 同じフォルダか（大文字小文字と末尾の区切りを無視）。 */
function samePath(a: string | null, b: string | null): boolean {
  const n = (p: string | null): string | null => (p === null ? null : p.replace(/[\\/]+$/, "").toLowerCase());
  return n(a) === n(b);
}
