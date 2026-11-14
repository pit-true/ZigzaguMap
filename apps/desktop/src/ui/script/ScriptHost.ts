import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  buildScriptIndex,
  eventScriptLabel,
  isEventScriptEntryActive,
  isScriptSourcePath,
  loadEventScripts,
  loadScriptsJson,
  parseEventScriptDefines,
  reloadScriptIndexFile,
  resolveScriptsJson,
  type EventScriptTarget,
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
} from "../../windows/script-editor/protocol";
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
  /** ウィンドウを開いたときのプロジェクトフォルダ（変わったら閉じる）。 */
  private projectDir: string | null = null;
  private index: Promise<ScriptIndex> | null = null;
  private nextQueryId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private readonly app: App) {}

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

  /** イベントのスクリプトを開く。見つからなければステータスバーに出して null。 */
  async openTarget(target: ScriptTarget): Promise<ScriptLocation | null> {
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

  /**
   * イベントのスクリプトの場所を求める。eventscripts の行（`#ifdef` で複数あれば、条件が成り立つもの）のラベルを
   * 索引で引き、見つからなければ scripts.json のマップの `.s` の 1 行目。どちらも無ければ null。
   */
  async resolve(target: ScriptTarget): Promise<ScriptLocation | null> {
    if (!this.app.state.session?.projectDir) throw new Error(t.noProject);
    const { bank, map } = target.map;
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
    const label = entry ? eventScriptLabel(entry.kind, entry.symbol, defines) : null;
    if (label) {
      const found = (await this.scriptIndex()).findLabel(label);
      if (found && isEditableScriptPath(found.path)) return { path: found.path, line: found.line, label, from: "label" };
    }
    const json = await loadScriptsJson(this.fs);
    const resolved = json ? resolveScriptsJson(json, bank, map) : null;
    if (resolved && isEditableScriptPath(resolved.script)) return { path: normalizeScriptPath(resolved.script), line: 1, label, from: "scriptsJson" };
    return null;
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
        const hello: ScriptEditorHello = { opens: this.pending };
        this.pending = [];
        return hello;
      }
      case "saved": {
        const path = normalizeScriptPath(request.path);
        if (this.index && isScriptSourcePath(path)) await reloadScriptIndexFile(await this.index, this.fs, path);
        return null;
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
        reject(new Error("スクリプトエディタが応答しません"));
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

/** 同じフォルダか（大文字小文字と末尾の区切りを無視）。 */
function samePath(a: string | null, b: string | null): boolean {
  const n = (p: string | null): string | null => (p === null ? null : p.replace(/[\\/]+$/, "").toLowerCase());
  return n(a) === n(b);
}
