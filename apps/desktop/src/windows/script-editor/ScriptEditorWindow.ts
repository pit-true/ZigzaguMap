import "./scriptEditor.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { ja } from "../../i18n/ja";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import { openDialogs } from "../../ui/Dialog";
import { messageBox } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { EditorTab, sameStat, type FileStat } from "./EditorTab";
import { buildExtensions, type EditorFileContext } from "./extensions";
import { decodeScriptText, encodeScriptText, isEditableScriptPath, normalizeScriptPath, scriptFileKind, type DecodedText } from "./fileText";
import type { ScriptEditorQuery } from "./protocol";
import { ScriptEditorClient } from "./ScriptEditorClient";

/** 外部の変更を調べる間隔（ms）。 */
const POLL_MS = 1000;

/**
 * スクリプトエディタの別ウィンドウ（tool.html → startToolWindow から、開いたときに初めて読み込む）。
 *
 * - タブ: ファイルごとに EditorState を持ち、EditorView は 1 つ（`setState` で切り替える）。
 * - 読み書きはプロジェクトフォルダの相対パスで `fs_read_text` / `fs_write_text`（フォルダはメインが `project_set_root` で
 *   決めたもの。Rust の状態はウィンドウで共有）。改行の形と BOM は読んだときのものを保つ。
 * - 外部の変更: 開いているファイルの `fs_stat` を 1 秒ごとと、ウィンドウが前面に戻ったときに調べる。
 *   未保存の変更が無ければ黙って読み直し（カーソルは残る）、あれば「読み直しますか？」と聞く。
 * - 編集は CommandBus を通さない（テキストの正本はディスクとこのバッファ。マップの履歴とは別）。
 */
export class ScriptEditorWindow {
  readonly tabs: EditorTab[] = [];
  private activeTab: EditorTab | null = null;
  readonly view: EditorView;
  private readonly client = new ScriptEditorClient();
  private readonly tabBar: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly status: HTMLElement;
  private readonly message: HTMLElement;
  private checking = false;
  private closing = false;
  private lastTitle = "";

  constructor(root: HTMLElement) {
    root.classList.add("script-editor");
    this.tabBar = document.createElement("div");
    this.tabBar.className = "se-tabs";
    this.tabBar.dataset["autoId"] = "se.tabs";
    const body = document.createElement("div");
    body.className = "se-body";
    this.empty = document.createElement("div");
    this.empty.className = "se-empty";
    this.empty.textContent = t.noFiles;
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
    bar.append(this.message, this.status);
    root.append(this.tabBar, body, bar);
    this.render();
  }

  /** メインとつなぎ、待っているファイルを開き、外部の変更の見張りを始める。 */
  async start(): Promise<void> {
    document.addEventListener("contextmenu", (e) => {
      if (!(e.target instanceof Node && this.view.dom.contains(e.target))) e.preventDefault();
    });
    document.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("focus", () => void this.checkExternal());
    await getCurrentWindow().onCloseRequested(async (event) => {
      if (this.closing) return;
      if (!(await this.confirmClose())) event.preventDefault();
    });
    await this.client.connect({
      open: (req) => void this.open(req.path, req.line),
      query: (q) => this.answer(q),
    });
    const { startScriptEditorAutomation } = await import("./automation");
    await startScriptEditorAutomation(this);
    const hello = await this.client.hello();
    for (const req of hello.opens) await this.open(req.path, req.line);
    setInterval(() => void this.checkExternal(), POLL_MS);
  }

  /** 表示中のタブ。 */
  get active(): EditorTab | null {
    return this.activeTab;
  }

  // ---- 開く・切り替える・閉じる ----

  /** ファイルを開く（開いていればそのタブへ切り替える）。行は 1 から。開けなければメッセージを出して false。 */
  async open(rawPath: string, line?: number): Promise<boolean> {
    const path = normalizeScriptPath(rawPath);
    if (!isEditableScriptPath(path)) {
      await messageBox(ja.errorTitle, t.notEditable(rawPath), "error");
      return false;
    }
    let tab = this.tabs.find((x) => x.path.toLowerCase() === path.toLowerCase()) ?? null;
    if (!tab) {
      let decoded: DecodedText;
      let stat: FileStat | null;
      try {
        stat = await statFile(path);
        decoded = decodeScriptText(await invoke<string>("fs_read_text", { path }));
      } catch (e) {
        await messageBox(ja.errorTitle, t.readFailed(path, errorText(e)), "error");
        return false;
      }
      // 読んでいる間に同じファイルが開かれていれば、そちらを使う
      tab = this.tabs.find((x) => x.path.toLowerCase() === path.toLowerCase()) ?? null;
      if (!tab) {
        tab = new EditorTab(path, scriptFileKind(path), EditorState.create({ doc: "" }), decoded.lineEnding, decoded.bom, stat);
        tab.state = this.createState(tab, decoded.text);
        tab.savedDoc = tab.state.doc;
        this.tabs.push(tab);
      }
    }
    this.activate(tab);
    if (line !== undefined) this.goToLine(line);
    this.view.focus();
    return true;
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
    if (this.activeTab === tab) {
      this.activeTab = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (next) this.activate(next);
      else this.view.setState(EditorState.create({ doc: "" }));
    }
    this.render();
    return true;
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
    if (!tab) return false;
    const doc = tab.state.doc;
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
    return true;
  }

  /** 未保存のタブを全部保存する。全部保存できたら true。 */
  async saveAll(): Promise<boolean> {
    let ok = true;
    for (const tab of this.tabs.filter((x) => x.dirty)) ok = (await this.save(tab)) && ok;
    return ok;
  }

  // ---- 外部の変更 ----

  /** 開いているファイルが外部で変わっていないか調べる（1 秒ごとと、前面に戻ったとき）。 */
  async checkExternal(): Promise<void> {
    if (this.checking || this.closing || openDialogs.length > 0) return;
    this.checking = true;
    try {
      for (const tab of [...this.tabs]) {
        if (tab.saving || !this.tabs.includes(tab)) continue;
        await this.checkTab(tab);
      }
    } finally {
      this.checking = false;
    }
  }

  private async checkTab(tab: EditorTab): Promise<void> {
    let stat: FileStat | null;
    try {
      stat = await statFile(tab.path);
    } catch {
      return;
    }
    if (!stat) {
      if (!tab.missing) {
        tab.missing = true;
        this.setMessage(t.deleted(tab.path));
        this.render();
      }
      return;
    }
    if (!tab.missing && sameStat(stat, tab.stat)) return;
    let decoded: DecodedText;
    try {
      decoded = decodeScriptText(await invoke<string>("fs_read_text", { path: tab.path }));
    } catch {
      return;
    }
    if (tab.saving) return;
    tab.missing = false;
    tab.stat = stat;
    if (decoded.text === tab.savedDoc.toString()) {
      tab.lineEnding = decoded.lineEnding;
      tab.bom = decoded.bom;
      this.render();
      return;
    }
    if (tab.dirty) {
      this.activate(tab);
      const answer = await messageBox(ja.question, t.confirmReload(tab.name), "warning", "yesNo");
      if (answer !== "yes" || !this.tabs.includes(tab)) return;
    }
    this.replaceText(tab, decoded);
    this.setMessage(t.reloaded(tab.path));
  }

  /**
   * 本文をディスクの内容に置き換える。変わった範囲だけを置き換えるので、カーソルと選択は同じ場所に残る。
   * 置き換えは履歴に入る（Ctrl+Z で読み直す前に戻せる）。
   */
  private replaceText(tab: EditorTab, decoded: DecodedText): void {
    const before = tab.state.doc.toString();
    const after = decoded.text;
    let start = 0;
    const max = Math.min(before.length, after.length);
    while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
    let end = 0;
    while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
    const spec = { changes: { from: start, to: before.length - end, insert: after.slice(start, after.length - end) } };
    if (tab === this.activeTab) this.view.dispatch(spec);
    else tab.state = tab.state.update(spec).state;
    tab.savedDoc = tab.state.doc;
    tab.lineEnding = decoded.lineEnding;
    tab.bom = decoded.bom;
    this.render();
  }

  // ---- 本体 ----

  /** ファイル 1 つ分の EditorState を作る（機能の拡張と、変更の見張り）。 */
  private createState(tab: EditorTab, text: string): EditorState {
    const ctx: EditorFileContext = {
      path: tab.path,
      kind: tab.kind,
      save: () => void this.save(tab),
      openFile: (path, line) => void this.open(path, line),
    };
    const extensions: Extension[] = [buildExtensions(ctx), EditorView.updateListener.of((u) => this.onUpdate(tab, u))];
    return EditorState.create({ doc: text, extensions });
  }

  private onUpdate(tab: EditorTab, u: ViewUpdate): void {
    tab.state = u.state;
    if (u.docChanged) this.render();
    else if (u.selectionSet) this.renderStatus();
  }

  private answer(query: ScriptEditorQuery): Promise<unknown> {
    switch (query.type) {
      case "dirty":
        return Promise.resolve(this.tabs.filter((x) => x.dirty).map((x) => x.path));
      case "saveAll":
        return this.saveAll();
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || !e.ctrlKey || e.altKey || openDialogs.length > 0) return;
    const key = e.key.toLowerCase();
    if (key === "s" && !e.shiftKey) void this.save();
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

  setMessage(text: string): void {
    this.message.textContent = text;
  }

  /** タブの帯・題名・下の帯を描き直す。 */
  private render(): void {
    this.tabBar.replaceChildren(
      ...this.tabs.map((tab) => {
        const el = document.createElement("div");
        el.className = "se-tab";
        el.classList.toggle("active", tab === this.activeTab);
        el.classList.toggle("dirty", tab.dirty);
        el.classList.toggle("missing", tab.missing);
        el.title = tab.path;
        el.dataset["autoId"] = `se.tab:${tab.path}`;
        const name = document.createElement("span");
        name.className = "se-tab-name";
        name.textContent = tab.name;
        const mark = document.createElement("span");
        mark.className = "se-tab-dirty";
        mark.textContent = "●";
        mark.title = t.dirtyMark;
        const close = document.createElement("button");
        close.type = "button";
        close.className = "se-tab-close";
        close.textContent = "×";
        close.title = t.closeTab;
        close.tabIndex = -1;
        close.dataset["autoId"] = `se.close:${tab.path}`;
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          void this.closeTab(tab);
        });
        el.addEventListener("mousedown", (e) => {
          if (e.button === 1) {
            e.preventDefault();
            void this.closeTab(tab);
          }
        });
        el.addEventListener("click", () => {
          this.activate(tab);
          this.view.focus();
        });
        el.append(name, mark, close);
        return el;
      }),
    );
    const has = this.activeTab !== null;
    this.view.dom.hidden = !has;
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

/** ファイルの更新日時と大きさ（無ければ null）。 */
function statFile(path: string): Promise<FileStat | null> {
  return invoke<FileStat | null>("fs_stat", { path });
}
