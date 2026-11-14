import "./scriptEditor.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorSelection, EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { planStringBodyEdit } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import { jaScriptEditorAssist as ta } from "../../i18n/ja.scriptEditorAssist";
import { openDialogs } from "../../ui/Dialog";
import { messageBox } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { BuildPanel } from "./BuildPanel";
import { EditorTab, statFile, type FileStat } from "./EditorTab";
import { ExternalChanges } from "./ExternalChanges";
import { buildExtensions, type EditorFileContext } from "./extensions";
import type { EditorHost } from "./extensions/context";
import { projectChangedEffect } from "./extensions/highlight";
import type { EditorThemeId } from "./extensions/themes";
import { WidthCheck } from "./extensions/widthCheck";
import { decodeScriptText, encodeScriptText, isEditableScriptPath, normalizeScriptPath, scriptFileKind, type DecodedText } from "./fileText";
import { LabelRenamer } from "./LabelRenamer";
import { Navigation } from "./Navigation";
import type { MessageHandlers, ScriptEditorQueryMap, ScriptRomOpenRequest } from "./protocol";
import { RomTabs } from "./RomTabs";
import { ScriptEditorClient } from "./ScriptEditorClient";
import { ScriptProject } from "./ScriptProject";
import { TabBar } from "./TabBar";
import { minimalChange } from "./textChange";
import { ThemeControl } from "./ThemeControl";

/** 外部の変更を調べる間隔（ms）。 */
const POLL_MS = 1000;

/**
 * スクリプトエディタの別ウィンドウ（tool.html → startToolWindow から、開いたときに初めて読み込む）。
 *
 * - タブ: ファイルごとに EditorState を持ち、EditorView は 1 つ（`setState` で切り替える）。
 * - 読み書きはプロジェクトフォルダの相対パスで `fs_read_text` / `fs_write_text`（フォルダはメインが `project_set_root` で
 *   決めたもの。Rust の状態はウィンドウで共有）。改行の形と BOM は読んだときのものを保つ。
 * - 機能ごとの部品: 外部の変更の見張り（ExternalChanges）、ラベル名の変更（LabelRenamer）、ROM のタブ（RomTabs）、
 *   「戻る」の履歴（Navigation）、テーマ（ThemeControl）、タブの帯（TabBar）、ビルドの欄（BuildPanel）、保存時の幅検査（WidthCheck）。
 * - 編集は CommandBus を通さない（テキストの正本はディスクとこのバッファ。マップの履歴とは別）。
 */
export class ScriptEditorWindow {
  readonly tabs: EditorTab[] = [];
  private activeTab: EditorTab | null = null;
  readonly view: EditorView;
  /** メインウィンドウとの窓口。 */
  readonly client = new ScriptEditorClient();
  private readonly tabBar: TabBar;
  private readonly empty: HTMLElement;
  private readonly status: HTMLElement;
  private readonly message: HTMLElement;
  private closing = false;
  private lastTitle = "";
  /** ビルドの欄（#198）。 */
  readonly build: BuildPanel;
  /** プロジェクトフォルダ（絶対パス。hello で受け取る）。 */
  private projectDir: string | null = null;
  /** 素の ROM のスクリプトのタブ（#206・#207）。 */
  private readonly roms: RomTabs;
  /** プロジェクトの知識（命令表・索引）。補助の機能が使う。 */
  readonly project = new ScriptProject();
  /** 外部の変更の見張り。 */
  private readonly external = new ExternalChanges(this);
  /** ラベル名の変更（#203）。 */
  private readonly renamer = new LabelRenamer(this);
  /** 「戻る」（Alt+←）の履歴。 */
  private readonly navigation = new Navigation(this);
  private readonly theme: ThemeControl;
  private refreshQueued = false;
  /** 保存時の幅検査（#197）。 */
  readonly widthCheck = new WidthCheck({
    project: this.project,
    view: () => this.view,
    activePath: () => this.activeTab?.path ?? null,
    setMessage: (text) => this.setMessage(text),
    report: (title, lines, problem) => this.build.appendOutside(title, lines, problem),
  });
  /** 拡張に渡すウィンドウの窓口。 */
  readonly host: EditorHost = {
    setMessage: (text) => this.setMessage(text),
    navigate: (path, line, column) => this.navigate(path, line, column),
    back: () => this.back(),
    editStringBody: (label, body) => this.editStringBody(label, body),
  };
  /** メインからの問い合わせの答え方（種類ごとに 1 つ）。 */
  private readonly queryHandlers: MessageHandlers<ScriptEditorQueryMap> = {
    dirty: () => this.tabs.filter((x) => x.dirty).map((x) => x.path),
    saveAll: () => this.saveAll(),
    bufferText: (q) => this.findTab(q.path)?.state.doc.toString() ?? null,
    setBufferText: (q) => this.setBufferText(q.path, q.text, q.save),
  };

  constructor(root: HTMLElement) {
    root.classList.add("script-editor");
    this.tabBar = new TabBar({
      select: (tab) => {
        this.activate(tab);
        this.view.focus();
      },
      close: (tab) => void this.closeTab(tab),
    });
    const body = document.createElement("div");
    body.className = "se-body";
    this.empty = document.createElement("div");
    this.empty.className = "se-empty";
    this.empty.textContent = t.noFiles;
    this.roms = new RomTabs(this);
    this.view = new EditorView({ parent: body });
    this.view.dom.dataset["autoId"] = "se.editor";
    body.append(this.empty);
    const bar = document.createElement("div");
    bar.className = "se-statusbar";
    this.message = document.createElement("span");
    this.message.className = "se-message";
    this.message.dataset["autoId"] = "se.message";
    this.status = document.createElement("span");
    this.status.className = "se-position";
    this.status.dataset["autoId"] = "se.position";
    this.theme = new ThemeControl(this);
    bar.append(this.message, this.status, this.theme.select);
    this.build = new BuildPanel({
      confirmSave: () => this.confirmSaveBeforeBuild(),
      mainDirty: async () => Number(await this.client.request({ type: "mainDirty" })),
      exportMain: async () => (await this.client.request({ type: "exportMain" })) === true,
      projectDir: () => this.projectDir,
      openFile: (path, line) => void this.open(path, line),
    });
    root.append(this.tabBar.element, this.roms.bar, body, this.build.element, bar);
    this.render();
  }

  /** メインとつなぎ、待っているファイルを開き、外部の変更の見張りを始める。 */
  async start(): Promise<void> {
    document.addEventListener("contextmenu", (e) => {
      if (!(e.target instanceof Node && this.view.dom.contains(e.target))) e.preventDefault();
    });
    document.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("focus", () => {
      void this.checkExternal();
      void this.project.refresh(new Set(this.tabs.map((x) => x.path)));
    });
    await this.theme.load();
    this.project.onChange(() => this.projectChanged());
    await getCurrentWindow().onCloseRequested(async (event) => {
      if (this.closing) return;
      if (!(await this.confirmClose())) event.preventDefault();
    });
    await this.client.connect({
      notices: {
        open: (req) => void this.open(req.path, req.line),
        build: () => void this.build.run(),
        openRom: (req) => void this.openRom(req),
      },
      queries: this.queryHandlers,
    });
    const { startScriptEditorAutomation } = await import("./automation");
    await startScriptEditorAutomation(this);
    const hello = await this.client.hello();
    this.projectDir = hello.projectDir ?? null;
    for (const req of hello.opens) await this.open(req.path, req.line);
    for (const req of hello.roms ?? []) this.openRom(req);
    if (hello.build) void this.build.run();
    setInterval(() => void this.checkExternal(), POLL_MS);
    // 命令表と索引は、最初のファイルを見せてから裏で読む
    void this.project.load();
  }

  /** 表示中のタブ。 */
  get active(): EditorTab | null {
    return this.activeTab;
  }

  /** ウィンドウを閉じているところか（外部の変更を調べない）。 */
  get isClosing(): boolean {
    return this.closing;
  }

  // ---- 開く・切り替える・閉じる ----

  /** ファイルを開く（開いていればそのタブへ切り替える）。行は 1 から。開けなければメッセージを出して false。 */
  async open(rawPath: string, line?: number): Promise<boolean> {
    const tab = await this.loadTab(rawPath);
    if (!tab) return false;
    this.activate(tab);
    if (line !== undefined) this.goToLine(line);
    this.view.focus();
    return true;
  }

  /** ファイルのタブを用意する（開いていればそのタブ。切り替えはしない）。開けなければメッセージを出して null。 */
  async loadTab(rawPath: string): Promise<EditorTab | null> {
    const path = normalizeScriptPath(rawPath);
    if (!isEditableScriptPath(path)) {
      await messageBox(ja.errorTitle, t.notEditable(rawPath), "error");
      return null;
    }
    let tab = this.findTab(path);
    if (!tab) {
      let decoded: DecodedText;
      let stat: FileStat | null;
      try {
        stat = await statFile(path);
        decoded = decodeScriptText(await invoke<string>("fs_read_text", { path }));
      } catch (e) {
        await messageBox(ja.errorTitle, t.readFailed(path, errorText(e)), "error");
        return null;
      }
      // 読んでいる間に同じファイルが開かれていれば、そちらを使う
      tab = this.findTab(path);
      if (!tab) {
        tab = new EditorTab(path, scriptFileKind(path), EditorState.create({ doc: "" }), decoded.lineEnding, decoded.bom, stat);
        tab.state = this.createState(tab, decoded.text);
        tab.savedDoc = tab.state.doc;
        this.tabs.push(tab);
        this.render();
      }
    }
    return tab;
  }

  /** 素の ROM のスクリプトを読み取り専用のタブで開く（#206。同じアドレスのタブがあれば中身を入れ替える）。 */
  openRom(req: ScriptRomOpenRequest): EditorTab {
    return this.roms.open(req);
  }

  /** 「.s に取り込む」: 付ける名前を一覧で確かめてから、メインで取り込む（#207）。`rename` を渡すと一覧を出さない（自動操作）。 */
  importRom(tab: EditorTab, rename?: Record<string, string>): Promise<unknown> {
    return this.roms.import(tab, rename);
  }

  /** タブを切り替える。 */
  activate(tab: EditorTab): void {
    if (this.activeTab === tab) return;
    if (this.activeTab) this.activeTab.scroll = this.view.scrollSnapshot();
    this.activeTab = tab;
    this.view.setState(tab.state);
    if (tab.scroll) this.view.dispatch({ effects: tab.scroll });
    this.render();
  }

  /** カーソルを行の先頭へ動かし、その行を中ほどに見せる。 */
  goToLine(line: number): void {
    const doc = this.view.state.doc;
    const n = Math.max(1, Math.min(doc.lines, Math.floor(line)));
    const pos = doc.line(n).from;
    this.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  }

  /** タブを閉じる。未保存なら「保存しますか？」と聞く（キャンセルなら閉じない）。閉じたら true。 */
  async closeTab(tab: EditorTab): Promise<boolean> {
    if (tab.dirty) {
      const answer = await messageBox(ja.question, t.confirmSave(tab.name), "warning", "yesNoCancel");
      if (answer === "cancel") return false;
      if (answer === "yes" && !(await this.save(tab))) return false;
    }
    const i = this.tabs.indexOf(tab);
    if (i < 0) return true;
    this.tabs.splice(i, 1);
    // 保存せずに閉じたら、索引をディスクの内容に戻す
    if (tab.dirty) void this.project.reloadFile(tab.path);
    if (this.activeTab === tab) {
      this.activeTab = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (next) this.activate(next);
      else this.view.setState(EditorState.create({ doc: "" }));
    }
    this.render();
    return true;
  }

  /** ビルドの前に、未保存のタブを保存するか聞く（はい = 全部保存、いいえ = そのまま、キャンセル = ビルドしない）。 */
  private async confirmSaveBeforeBuild(): Promise<boolean> {
    const dirty = this.tabs.filter((x) => x.dirty);
    if (dirty.length === 0) return true;
    const text = dirty.length === 1 ? t.confirmSave(dirty[0]!.name) : t.confirmSaveMany(dirty.length);
    const answer = await messageBox(ja.question, text, "warning", "yesNoCancel");
    if (answer === "cancel") return false;
    return answer === "yes" ? this.saveAll() : true;
  }

  /** ウィンドウを閉じてよいか（未保存があれば聞く。「はい」なら全部保存する）。 */
  async confirmClose(): Promise<boolean> {
    const dirty = this.tabs.filter((x) => x.dirty);
    if (dirty.length === 0) return true;
    if (dirty.length === 1) this.activate(dirty[0]!);
    const text = dirty.length === 1 ? t.confirmSave(dirty[0]!.name) : t.confirmSaveMany(dirty.length);
    const answer = await messageBox(ja.question, text, "warning", "yesNoCancel");
    if (answer === "cancel") return false;
    if (answer === "yes") return this.saveAll();
    return true;
  }

  /** ウィンドウを閉じる（× と同じ。未保存なら聞く）。 */
  async closeWindow(): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.closing = true;
    // 自動操作の返事（ダイアログを押した返事）を送り終えてから閉じる
    setTimeout(() => void getCurrentWindow().destroy(), 300);
  }

  // ---- 保存 ----

  /** 保存する（既定は表示中のタブ）。改行の形と BOM は読んだときのもの。保存できたら true。 */
  async save(tab: EditorTab | null = this.activeTab): Promise<boolean> {
    if (!tab || tab.rom) return false;
    const doc = tab.state.doc;
    const before = tab.savedDoc.toString();
    tab.saving = true;
    try {
      await invoke("fs_write_text", { path: tab.path, text: encodeScriptText(doc.toString(), tab.lineEnding, tab.bom) });
      tab.savedDoc = doc;
      tab.missing = false;
      tab.stat = await statFile(tab.path).catch(() => null);
    } catch (e) {
      await messageBox(ja.errorTitle, t.saveFailed(tab.path, errorText(e)), "error");
      return false;
    } finally {
      tab.saving = false;
    }
    this.setMessage(t.saved(tab.path));
    this.render();
    this.client.saved(tab.path);
    void this.renamer.checkManualRename(tab, before, doc.toString());
    void this.project.reloadFile(tab.path);
    this.widthCheck.afterSave(tab.path, doc.toString());
    return true;
  }

  /** 未保存のタブを全部保存する。全部保存できたら true。 */
  async saveAll(): Promise<boolean> {
    let ok = true;
    for (const tab of this.tabs.filter((x) => x.dirty)) ok = (await this.save(tab)) && ok;
    return ok;
  }

  /** 未保存のタブを全部保存して、件数を下の帯に出す（Ctrl+Shift+S）。 */
  async saveAllWithMessage(): Promise<boolean> {
    const count = this.tabs.filter((x) => x.dirty).length;
    const ok = await this.saveAll();
    if (ok && count > 0) this.setMessage(ta.savedAll(count));
    return ok;
  }

  // ---- ラベル名の変更（#203）・外部の変更 ----

  /** ラベル名を変える（F2。LabelRenamer）。`to` を渡すと名前を聞かない（自動操作）。変えた数を返す。 */
  renameLabel(from: string, to?: string): Promise<{ count: number; files: string[]; uses: number } | null> {
    return this.renamer.rename(from, to);
  }

  /** 開いているファイルが外部で変わっていないか調べる（1 秒ごとと、前面に戻ったとき。ExternalChanges）。 */
  checkExternal(): Promise<void> {
    return this.external.check();
  }

  // ---- 本体 ----

  /** ファイル 1 つ分の EditorState を作る（機能の拡張と、変更の見張り）。 */
  createState(tab: EditorTab, text: string): EditorState {
    const extensions: Extension[] = [buildExtensions(this.fileContext(tab)), EditorView.updateListener.of((u) => this.onUpdate(tab, u))];
    if (tab.rom) extensions.push(EditorState.readOnly.of(true));
    return EditorState.create({ doc: text, extensions });
  }

  /** タブの拡張に渡す、ファイルの情報とウィンドウの窓口（自動操作も同じものを使う）。 */
  fileContext(tab: EditorTab): EditorFileContext {
    return {
      path: tab.path,
      kind: tab.kind,
      save: () => void this.save(tab),
      openFile: (path, line) => void this.open(path, line),
      renameLabel: (from) => void this.renameLabel(from),
      project: this.project,
      host: this.host,
    };
  }

  /** タブの本文や設定を変える（表示中ならビューで、そうでなければタブの EditorState で）。 */
  dispatchTo(tab: EditorTab, spec: TransactionSpec): void {
    if (tab === this.activeTab) this.view.dispatch(spec);
    else tab.state = tab.state.update(spec).state;
  }

  private onUpdate(tab: EditorTab, u: ViewUpdate): void {
    tab.state = u.state;
    if (u.docChanged) this.project.updateBuffer(tab.path, u.state.doc);
    if (u.docChanged) this.render();
    else if (u.selectionSet) this.renderStatus();
  }

  /** 開いているタブ（大文字小文字は区別しない）。 */
  findTab(rawPath: string): EditorTab | null {
    const path = normalizeScriptPath(rawPath).toLowerCase();
    return this.tabs.find((x) => x.path.toLowerCase() === path) ?? null;
  }

  /** メインから届いた書き換え（ひな形など）を本文に入れる。`save` は、前に未保存の変更が無かったときだけ保存する。変わった範囲だけを置き換え、元に戻す履歴に入る。 */
  private async setBufferText(path: string, text: string, save: boolean): Promise<boolean> {
    const tab = this.findTab(path);
    if (!tab) return false;
    const wasDirty = tab.dirty;
    const spec = minimalChange(tab.state.doc.toString(), text);
    if (spec) this.dispatchTo(tab, { ...spec, userEvent: "input.main" });
    this.render();
    // 保存するのは、書き換える前に未保存の変更が無かったときだけ（ほかの編集を勝手に保存しない）
    return save && !wasDirty ? this.save(tab) : true;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || !e.ctrlKey || e.altKey || openDialogs.length > 0) return;
    const key = e.key.toLowerCase();
    if (key === "s" && !e.shiftKey) void this.save();
    else if (key === "b" && !e.shiftKey) void this.build.run();
    else if (key === "s" && e.shiftKey) void this.saveAllWithMessage();
    else if (key === "w" && !e.shiftKey) {
      if (this.activeTab) void this.closeTab(this.activeTab);
    } else if (key === "tab") this.cycle(e.shiftKey ? -1 : 1);
    else return;
    e.preventDefault();
  }

  private cycle(step: number): void {
    if (this.tabs.length < 2 || !this.activeTab) return;
    const i = this.tabs.indexOf(this.activeTab);
    this.activate(this.tabs[(i + step + this.tabs.length) % this.tabs.length]!);
  }

  // ---- 補助の機能の窓口 ----

  /** 索引が変わったら、表示中のタブの色と波線を描き直す（まとめて 1 回）。 */
  private projectChanged(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      if (this.activeTab) this.view.dispatch({ effects: projectChangedEffect.of(null) });
    });
  }

  /** 今の位置を「戻る」の履歴に積んでから、ファイルの行（と桁）へ移る。 */
  navigate(path: string, line: number, column?: number): Promise<boolean> {
    return this.navigation.navigate(path, line, column);
  }

  /** 「戻る」（Alt+←）。戻る場所が無ければ false。 */
  back(): Promise<boolean> {
    return this.navigation.back();
  }

  /** 戻る履歴の数（自動操作用）。 */
  get backDepth(): number {
    return this.navigation.depth;
  }

  /**
   * `.string` のラベルの本文を差し替える（そのファイルのタブの本文を変えて未保存にする。開いていなければ裏で開く）。
   * 差し替えたファイルのパスを返す。ラベルが見つからなければ null。本文に書けない文字列なら例外（StringFileError）。
   */
  async editStringBody(label: string, body: string): Promise<string | null> {
    this.project.flushBuffers();
    const entries = this.project.assist.strings.find(label);
    const entry = entries.find((e) => this.tabs.some((x) => x.path === e.path)) ?? entries[0];
    if (!entry) return null;
    const tab = await this.loadTab(entry.path);
    if (!tab) return null;
    const change = planStringBodyEdit(tab.state.doc.toString(), label, body);
    if (change) {
      this.dispatchTo(tab, { changes: change, userEvent: "input.stringEdit" });
      // 表示していないタブはビューの更新を通らないので、ここで索引に入れる
      if (tab !== this.activeTab) this.project.updateBuffer(tab.path, tab.state.doc);
    }
    this.render();
    return tab.path;
  }

  /** テーマを変える（全部のタブに当て、個人設定に残す）。 */
  setTheme(id: EditorThemeId): void {
    this.theme.set(id);
  }

  setMessage(text: string): void {
    this.message.textContent = text;
  }

  /** タブの帯・題名・下の帯を描き直す。 */
  render(): void {
    this.tabBar.render(this.tabs, this.activeTab);
    const has = this.activeTab !== null;
    this.view.dom.hidden = !has;
    this.roms.render(this.activeTab);
    this.empty.hidden = has;
    const title = t.windowTitle(this.activeTab?.name ?? null, this.activeTab?.dirty ?? false);
    if (title !== this.lastTitle) {
      this.lastTitle = title;
      document.title = title;
      void getCurrentWindow().setTitle(title).catch(() => undefined);
    }
    this.renderStatus();
  }

  private renderStatus(): void {
    const tab = this.activeTab;
    if (!tab) {
      this.status.textContent = "";
      return;
    }
    const sel = this.view.state.selection.main;
    const line = this.view.state.doc.lineAt(sel.head);
    const parts = [t.cursor(line.number, sel.head - line.from + 1)];
    if (!sel.empty) parts.push(t.selected(sel.to - sel.from));
    parts.push(t.lineEnding(tab.lineEnding));
    if (tab.bom) parts.push(t.bom);
    this.status.textContent = parts.join("　");
  }
}
