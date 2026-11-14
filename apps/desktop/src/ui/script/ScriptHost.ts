import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { RenameEventLabelCommand, type ScriptImportPlan } from "@zigzagumap/core";
import type { App } from "../../app/App";
import type { WindowPlacement } from "../../app/Settings";
import { TauriProjectFs } from "../../app/TauriProjectFs";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import { errorText } from "../../util/errors";
import { PendingReplies, replyOf } from "../../util/pendingReplies";
import { isEditableScriptPath, normalizeScriptPath } from "../../windows/script-editor/fileText";
import {
  SCRIPT_EDITOR_SIZE,
  SCRIPT_EDITOR_WINDOW,
  ScriptEditorEvents,
  ScriptEditorNoticeEvents,
  handleMessage,
  type MessageHandlers,
  type MessageOf,
  type ScriptEditorEnvelope,
  type ScriptEditorNoticeMap,
  type ScriptEditorQueryEnvelope,
  type ScriptEditorQueryMap,
  type ScriptEditorReply,
  type ScriptEditorRequestMap,
  type ScriptOpenRequest,
  type ScriptRomOpenRequest,
} from "../../windows/script-editor/protocol";
import { RomScripts } from "./RomScripts";
import type { ScriptTarget } from "./ScriptEntry";
import { ScriptLocator, labelUseCount, type ScriptLocation } from "./ScriptLocator";

export type { ScriptLocation } from "./ScriptLocator";

/** `tool-placement` の中身。 */
interface PlacementEvent extends WindowPlacement {
  readonly label: string;
}

/** 問い合わせの答えを待つ時間（ms）。 */
const QUERY_TIMEOUT_MS = 10_000;

/**
 * メインウィンドウ側の、スクリプトエディタ（別ウィンドウ）の窓口。初めてスクリプトを開くときに読み込む（メインの起動では読まない）。
 *
 * - イベント（マップ・種別・番号）→ eventscripts のラベル → ラベルの索引（ScriptIndex）で `.s` と行を求める（ScriptLocator）。
 *   ラベルが見つからなければ maps\scripts.json のマップの `.s` の先頭を開く。
 * - ウィンドウは大きさを変えられ、位置と大きさを個人設定の `toolWindows` に覚える。
 * - ラベルの索引はメインが持つ（名前・ファイル・行だけ）。初めて使うときに作り、エディタで保存したファイルの分だけ読み直す。
 *   メインウィンドウが前面に戻ったとき（外のエディタで書き換えたかもしれない）は捨て、次に使うときに作り直す。
 * - エディタからの要求は `requestHandlers`（種類ごとに 1 つ）で答える。種類を足すときは protocol.ts の
 *   ScriptEditorRequestMap と `requestHandlers` に 1 つずつ足す。
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
  private readonly locator: ScriptLocator;
  /** ウィンドウを開いたときのプロジェクトフォルダ（変わったら閉じる）。 */
  private projectDir: string | null = null;
  /** 問い合わせの返事を待つもの。 */
  private readonly queries = new PendingReplies();

  /** エディタからの要求の答え方（種類ごとに 1 つ）。 */
  private readonly requestHandlers: MessageHandlers<ScriptEditorRequestMap> = {
    hello: () => {
      this.ready = true;
      this.opened = true;
      const hello = { opens: this.pending, roms: this.pendingRoms, projectDir: this.app.state.session?.projectDir ?? null, build: this.pendingBuild };
      this.pending = [];
      this.pendingRoms = [];
      this.pendingBuild = false;
      return hello;
    },
    saved: async (request) => {
      const path = normalizeScriptPath(request.path);
      await this.locator.fileChanged(path);
      this.app.scripts.files.forget(path);
      return null;
    },
    mainDirty: () => {
      const session = this.app.state.session;
      if (!session) return 0;
      const maps = session.modifiedMaps().length;
      return maps + (maps === 0 && (session.hasUnsavedChanges() || session.isRegionMapModified()) ? 1 : 0);
    },
    exportMain: () => this.app.exportMaps(false),
    importRom: (request) => this.importRom(request.pointer, request.target, new Map(Object.entries(request.rename))),
    labelRenamed: (request) => this.labelRenamed(request.from, request.to),
    labelUses: (request) => {
      const store = this.app.state.session?.labels.store;
      return store ? labelUseCount(store, request.label) : 0;
    },
    setting: (request) => {
      this.app.state.settings.update({ [request.key]: request.value });
      return null;
    },
  };

  private constructor(private readonly app: App) {
    this.roms = new RomScripts(app);
    this.locator = new ScriptLocator(app, this.fs);
  }

  private async start(): Promise<void> {
    await listen<ScriptEditorEnvelope>(ScriptEditorEvents.request, (e) => void this.onRequest(e.payload));
    await listen<ScriptEditorReply>(ScriptEditorEvents.answer, (e) => this.queries.settle(e.payload));
    await listen<string>("tool-closed", (e) => {
      if (e.payload !== SCRIPT_EDITOR_WINDOW) return;
      this.opened = false;
      this.ready = false;
      this.pending = [];
      this.pendingRoms = [];
      this.pendingBuild = false;
      this.queries.rejectAll(new Error("closed"));
    });
    await listen<PlacementEvent>("tool-placement", (e) => {
      const { label, ...placement } = e.payload;
      if (label !== SCRIPT_EDITOR_WINDOW) return;
      const settings = this.app.state.settings;
      settings.update({ toolWindows: { ...settings.data.toolWindows, [label]: placement } });
    });
    await getCurrentWindow().listen("tauri://focus", () => this.locator.reset());
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
    if (this.ready) await this.notify("open", request);
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
    if (this.ready) await this.notify("build", null);
    else this.pendingBuild = true;
    await this.openWindow();
  }

  /**
   * イベントのスクリプトの場所を求める。eventscripts の行（`#ifdef` で複数あれば、条件が成り立つもの）のラベルを
   * 索引で引き、見つからなければ scripts.json のマップの `.s` の 1 行目。どちらも無ければ null。
   */
  resolve(target: ScriptTarget): Promise<ScriptLocation | null> {
    return this.locator.resolve(target);
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
    if (this.ready) await this.notify("openRom", request);
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
    const found = (await this.locator.scriptIndex()).findLabel(label);
    if (!found || !isEditableScriptPath(found.path)) {
      this.app.state.setStatus(t.labelMissing(label));
      return false;
    }
    return this.openFile(found.path, found.line);
  }

  /** プロジェクトのラベルの名前（索引から）。 */
  async labelNames(): Promise<string[]> {
    return (await this.locator.scriptIndex()).labelNames();
  }

  /**
   * エディタでラベル名を変えた（#203）。そのラベルを使うイベントかマップスクリプトがあれば、eventscripts とイベントの側を変える
   * コマンド（元に戻せる）を実行する。変えた数を返す。
   */
  labelRenamed(from: string, to: string): number {
    const session = this.app.state.session;
    if (!session || from === to) return 0;
    const uses = labelUseCount(session.labels.store, from);
    if (uses === 0) return 0;
    if (this.app.scripts.execute(new RenameEventLabelCommand({ from, to }))) this.app.state.setStatus(t.labelRenamed(from, to, uses));
    return uses;
  }

  // ---- メインからの書き換え ----

  /** エディタで開いているファイルの本文（開いていなければ null）。 */
  async bufferText(path: string): Promise<string | null> {
    if (!this.ready) return null;
    return this.query({ type: "bufferText", path: normalizeScriptPath(path) });
  }

  /** エディタで開いているファイルの本文を書き換える（開いていなければ false）。 */
  async setBufferText(path: string, text: string, save: boolean): Promise<boolean> {
    if (!this.ready) return false;
    const ok = (await this.query({ type: "setBufferText", path: normalizeScriptPath(path), text, save })) === true;
    if (ok && save) await this.fileChanged(path);
    return ok;
  }

  /** メインがディスクのファイルを書き換えた（ラベルの索引のそのファイルの分を読み直す）。 */
  fileChanged(rawPath: string): Promise<void> {
    return this.locator.fileChanged(rawPath);
  }

  /** 編集中のラベル（ZigzaguMap のラベルの持ち方で付いているもの）。無ければ null。 */
  labelOf(target: ScriptTarget): string | null {
    return this.locator.labelOf(target);
  }

  // ---- 閉じる・未保存の確認 ----

  /** エディタの未保存のファイル（開いていなければ空）。 */
  async dirtyFiles(): Promise<string[]> {
    if (!this.ready) return [];
    return this.query({ type: "dirty" });
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
    this.locator.reset();
    // 別のプロジェクトフォルダを開いたら閉じる（相対パスが別のフォルダを指すため）。同じフォルダの開き直しなら残す
    const dir = this.app.state.session?.projectDir ?? null;
    if (this.opened && !samePath(dir, this.projectDir)) this.close();
  }

  /** エディタへ知らせる（返事は無い）。 */
  private notify<K extends keyof ScriptEditorNoticeMap>(kind: K, payload: ScriptEditorNoticeMap[K]): Promise<void> {
    return emitTo(SCRIPT_EDITOR_WINDOW, ScriptEditorNoticeEvents[kind], payload);
  }

  private async onRequest(envelope: ScriptEditorEnvelope): Promise<void> {
    const reply = await replyOf(envelope.id, () => handleMessage(this.requestHandlers, envelope.request));
    await emitTo(SCRIPT_EDITOR_WINDOW, ScriptEditorEvents.reply, reply).catch(() => undefined);
  }

  /** エディタへ問い合わせて答えを待つ（返事の型は種類で決まる。答えが無ければ QUERY_TIMEOUT_MS で失敗）。 */
  private query<K extends keyof ScriptEditorQueryMap>(query: MessageOf<ScriptEditorQueryMap, K>): Promise<ScriptEditorQueryMap[K]["reply"]> {
    const { id, reply, fail } = this.queries.open({ ms: QUERY_TIMEOUT_MS, error: () => new Error(t.noReply) });
    const envelope = { id, query } as ScriptEditorQueryEnvelope;
    emitTo(SCRIPT_EDITOR_WINDOW, ScriptEditorEvents.query, envelope).catch(fail);
    return reply as Promise<ScriptEditorQueryMap[K]["reply"]>;
  }
}

/** 同じフォルダか（大文字小文字と末尾の区切りを無視）。 */
function samePath(a: string | null, b: string | null): boolean {
  const n = (p: string | null): string | null => (p === null ? null : p.replace(/[\\/]+$/, "").toLowerCase());
  return n(a) === n(b);
}
