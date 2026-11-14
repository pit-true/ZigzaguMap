import "./scriptEditor.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { planStringBodyEdit } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import { jaScriptEditorAssist as ta } from "../../i18n/ja.scriptEditorAssist";
import { openDialogs } from "../../ui/Dialog";
import { messageBox } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { BuildPanel } from "./BuildPanel";
import { jaRomScript } from "../../i18n/ja.romScript";
import { openRomImportDialog } from "./RomImportDialog";
import { detectLabelRename, indexAsmFile, isScriptLabelName, renameLabelInText } from "@zigzagumap/core";
import { inputDialog } from "../../ui/InputDialog";
import { EditorTab, sameStat, type FileStat } from "./EditorTab";
import { buildExtensions, type EditorFileContext } from "./extensions";
import type { EditorHost } from "./extensions/context";
import { projectChangedEffect } from "./extensions/highlight";
import { EDITOR_THEMES, currentEditorTheme, isEditorTheme, setCurrentEditorTheme, themeCompartment, themeFor, type EditorThemeId } from "./extensions/themes";
import { WidthCheck } from "./extensions/widthCheck";
import { ScriptProject } from "./ScriptProject";
import { decodeScriptText, encodeScriptText, isEditableScriptPath, normalizeScriptPath, scriptFileKind, type DecodedText } from "./fileText";
import type { ScriptEditorQuery, ScriptRomOpenRequest } from "./protocol";
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
  /** ビルドの欄（#198）。 */
  readonly build: BuildPanel;
  /** プロジェクトフォルダ（絶対パス。hello で受け取る）。 */
  private projectDir: string | null = null;
  /** ROM のタブの上の帯（読み取り専用の印と「.s に取り込む」）。 */
  private readonly romBar: HTMLElement;
  private readonly romImport: HTMLButtonElement;
  /** プロジェクトの知識（命令表・索引）。補助の機能が使う。 */
  readonly project = new ScriptProject();
  /** 「戻る」（Alt+←）の履歴（定義へ移動の前の位置）。 */
  private readonly backStack: { path: string; pos: number }[] = [];
  private refreshQueued = false;
  private themeSelectEl: HTMLSelectElement | null = null;
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
    this.romBar = document.createElement("div");
    this.romBar.className = "se-rom-bar";
    this.romBar.dataset["autoId"] = "se.romBar";
    this.romBar.hidden = true;
    const romNote = document.createElement("span");
    romNote.textContent = jaRomScript.readOnly;
    this.romImport = document.createElement("button");
    this.romImport.type = "button";
    this.romImport.textContent = jaRomScript.importButton;
    this.romImport.dataset["autoId"] = "se.romImport";
    this.romImport.addEventListener("click", () => {
      if (this.activeTab?.rom) void this.importRom(this.activeTab);
    });
    this.romBar.append(romNote, this.romImport);
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
    bar.append(this.message, this.status, this.themeSelect());
    this.build = new BuildPanel({
      confirmSave: () => this.confirmSaveBeforeBuild(),
      mainDirty: async () => Number(await this.client.request({ type: "mainDirty" })),
      exportMain: async () => (await this.client.request({ type: "exportMain" })) === true,
      projectDir: () => this.projectDir,
      openFile: (path, line) => void this.open(path, line),
    });
    root.append(this.tabBar, this.romBar, body, this.build.element, bar);
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
    await this.loadTheme();
    this.project.onChange(() => this.projectChanged());
    await getCurrentWindow().onCloseRequested(async (event) => {
      if (this.closing) return;
      if (!(await this.confirmClose())) event.preventDefault();
    });
    await this.client.connect({
      open: (req) => void this.open(req.path, req.line),
      query: (q) => this.answer(q),
      build: () => void this.build.run(),
      openRom: (req) => this.openRom(req),
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
    let tab = this.tabs.find((x) => x.path.toLowerCase() === path.toLowerCase()) ?? null;
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
      tab = this.tabs.find((x) => x.path.toLowerCase() === path.toLowerCase()) ?? null;
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
    let tab = this.tabs.find((x) => x.rom && x.path === req.key) ?? null;
    if (tab) {
      tab.rom = req;
      tab.state = this.createState(tab, req.text);
      tab.savedDoc = tab.state.doc;
      if (tab === this.activeTab) this.view.setState(tab.state);
    } else {
      tab = new EditorTab(req.key, "asm", EditorState.create({ doc: "" }), "\n", false, null);
      tab.rom = req;
      tab.state = this.createState(tab, req.text);
      tab.savedDoc = tab.state.doc;
      this.tabs.push(tab);
    }
    this.activate(tab);
    this.render();
    return tab;
  }

  /** 「.s に取り込む」: 付ける名前を一覧で確かめてから、メインで取り込む（#207）。`rename` を渡すと一覧を出さない（自動操作）。 */
  async importRom(tab: EditorTab, rename?: Record<string, string>): Promise<unknown> {
    const rom = tab.rom;
    if (!rom) return null;
    if (!rom.importable || !rom.target) {
      this.setMessage(jaRomScript.notImportable);
      return null;
    }
    const chosen = rename ?? (await openRomImportDialog(rom));
    if (!chosen) return null;
    try {
      const plan = (await this.client.request({ type: "importRom", pointer: rom.pointer, target: rom.target, rename: chosen })) as { entryLabel: string };
      this.setMessage(jaRomScript.importDone(plan.entryLabel));
      return plan;
    } catch (e) {
      this.setMessage(jaRomScript.importFailed(errorText(e)));
      await messageBox(ja.errorTitle, jaRomScript.importFailed(errorText(e)), "error");
      return null;
    }
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
    void this.checkManualRename(tab, before, doc.toString());
    void this.project.reloadFile(tab.path);
    this.widthCheck.afterSave(tab.path, doc.toString());
    return true;
  }

  // ---- ラベル名の変更（#203） ----

  /**
   * ラベル名を変える（F2）。`assembly/overworld_scripts` の下のすべての `.s` の定義と参照を変え（開いているタブは本文を、
   * 開いていないファイルはディスクを書き換える）、メインへ知らせる（メインはイベントと eventscripts の側を変えるコマンドを実行する）。
   * `to` を渡すと名前を聞かない（自動操作）。変えた数を返す。
   */
  async renameLabel(from: string, to?: string): Promise<{ count: number; files: string[]; uses: number } | null> {
    const next = to ?? (await inputDialog(t.renameTitle, t.renamePrompt(from), from));
    if (next === null || next === from) return null;
    if (!isScriptLabelName(next)) {
      await messageBox(ja.errorTitle, t.renameInvalid(next), "error");
      return null;
    }
    let count = 0;
    const files: string[] = [];
    for (const path of await listAsmFiles("assembly/overworld_scripts")) {
      const tab = this.findTab(path);
      try {
        if (tab) {
          const r = renameLabelInText(tab.state.doc.toString(), from, next);
          if (r.count === 0) continue;
          const spec = minimalChange(tab.state.doc.toString(), r.text)!;
          if (tab === this.activeTab) this.view.dispatch({ ...spec, userEvent: "input.rename" });
          else tab.state = tab.state.update({ ...spec, userEvent: "input.rename" }).state;
          count += r.count;
        } else {
          const decoded = decodeScriptText(await invoke<string>("fs_read_text", { path }));
          const r = renameLabelInText(decoded.text, from, next);
          if (r.count === 0) continue;
          await invoke("fs_write_text", { path, text: encodeScriptText(r.text, decoded.lineEnding, decoded.bom) });
          this.client.saved(path);
          void this.project.reloadFile(path);
          count += r.count;
        }
        files.push(path);
      } catch (e) {
        await messageBox(ja.errorTitle, t.saveFailed(path, errorText(e)), "error");
      }
    }
    this.render();
    const uses = Number(await this.client.request({ type: "labelRenamed", from, to: next, path: this.activeTab?.path ?? "" }).catch(() => 0));
    this.setMessage(t.renamed(from, next, count, files.length, uses));
    return { count, files, uses };
  }

  /** 保存するとき、手で書き換えたラベルが 1 つだけなら（消えた 1 つと増えた 1 つ）、イベントのラベルも変えるか聞く。 */
  private async checkManualRename(tab: EditorTab, before: string, after: string): Promise<void> {
    if (tab.kind !== "asm") return;
    const names = (text: string): string[] => indexAsmFile(tab.path, text).labels.map((l) => l.name);
    const found = detectLabelRename(names(before), names(after));
    if (!found) return;
    const uses = Number(await this.client.request({ type: "labelUses", label: found.from }).catch(() => 0));
    if (uses === 0) return;
    const answer = await messageBox(ja.question, t.confirmRename(found.from, found.to, uses), "question", "yesNo");
    if (answer !== "yes") return;
    const n = Number(await this.client.request({ type: "labelRenamed", from: found.from, to: found.to, path: tab.path }).catch(() => 0));
    this.setMessage(t.renamed(found.from, found.to, 0, 0, n));
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
        if (tab.saving || tab.rom || !this.tabs.includes(tab)) continue;
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

  private onUpdate(tab: EditorTab, u: ViewUpdate): void {
    tab.state = u.state;
    if (u.docChanged) this.project.updateBuffer(tab.path, u.state.doc);
    if (u.docChanged) this.render();
    else if (u.selectionSet) this.renderStatus();
  }

  private answer(query: ScriptEditorQuery): Promise<unknown> {
    switch (query.type) {
      case "dirty":
        return Promise.resolve(this.tabs.filter((x) => x.dirty).map((x) => x.path));
      case "saveAll":
        return this.saveAll();
      case "bufferText":
        return Promise.resolve(this.findTab(query.path)?.state.doc.toString() ?? null);
      case "setBufferText":
        return this.setBufferText(query.path, query.text, query.save);
    }
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
    if (spec) {
      if (tab === this.activeTab) this.view.dispatch({ ...spec, userEvent: "input.main" });
      else tab.state = tab.state.update({ ...spec, userEvent: "input.main" }).state;
    }
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

  /** 未保存のタブを全部保存して、件数を下の帯に出す（Ctrl+Shift+S）。 */
  async saveAllWithMessage(): Promise<boolean> {
    const count = this.tabs.filter((x) => x.dirty).length;
    const ok = await this.saveAll();
    if (ok && count > 0) this.setMessage(ta.savedAll(count));
    return ok;
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
  async navigate(path: string, line: number, column?: number): Promise<boolean> {
    const from = this.activeTab ? { path: this.activeTab.path, pos: this.view.state.selection.main.head } : null;
    if (!(await this.open(path, line))) return false;
    if (from) this.backStack.push(from);
    if (this.backStack.length > 100) this.backStack.shift();
    if (column !== undefined && column > 1) {
      const l = this.view.state.doc.line(Math.max(1, Math.min(this.view.state.doc.lines, line)));
      this.view.dispatch({ selection: EditorSelection.cursor(Math.min(l.to, l.from + column - 1)) });
    }
    return true;
  }

  /** 「戻る」（Alt+←）。戻る場所が無ければ false。 */
  async back(): Promise<boolean> {
    const to = this.backStack.pop();
    if (!to) return false;
    if (!(await this.open(to.path))) return false;
    const pos = Math.min(to.pos, this.view.state.doc.length);
    this.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    return true;
  }

  /** 戻る履歴の数（自動操作用）。 */
  get backDepth(): number {
    return this.backStack.length;
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
      const spec = { changes: change, userEvent: "input.stringEdit" };
      if (tab === this.activeTab) this.view.dispatch(spec);
      else {
        tab.state = tab.state.update(spec).state;
        this.project.updateBuffer(tab.path, tab.state.doc);
      }
    }
    this.render();
    return tab.path;
  }

  /** 個人設定のテーマを読む（無ければ既定）。 */
  private async loadTheme(): Promise<void> {
    try {
      const text = await invoke<string>("load_settings");
      const saved = text ? (JSON.parse(text) as { scriptEditorTheme?: unknown }).scriptEditorTheme : undefined;
      setCurrentEditorTheme(isEditorTheme(saved) ? saved : currentEditorTheme());
      if (this.themeSelectEl) this.themeSelectEl.value = currentEditorTheme();
    } catch {
      setCurrentEditorTheme(currentEditorTheme());
    }
  }

  /** 下の帯のテーマの選択欄。 */
  private themeSelect(): HTMLElement {
    const select = document.createElement("select");
    select.className = "se-theme";
    select.title = ta.themeLabel;
    select.dataset["autoId"] = "se.theme";
    for (const id of EDITOR_THEMES) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = ta.themes[id] ?? id;
      select.append(option);
    }
    select.value = currentEditorTheme();
    select.addEventListener("change", () => {
      if (isEditorTheme(select.value)) this.setTheme(select.value);
      this.view.focus();
    });
    this.themeSelectEl = select;
    return select;
  }

  /** テーマを変える（全部のタブに当て、個人設定に残す）。 */
  setTheme(id: EditorThemeId): void {
    setCurrentEditorTheme(id);
    if (this.themeSelectEl) this.themeSelectEl.value = id;
    const effects = themeCompartment.reconfigure(themeFor(id));
    for (const tab of this.tabs) {
      if (tab === this.activeTab) this.view.dispatch({ effects });
      else tab.state = tab.state.update({ effects }).state;
    }
    this.client.setting("scriptEditorTheme", id);
    this.setMessage(ta.themeChanged(ta.themes[id] ?? id));
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
    const rom = this.activeTab?.rom ?? null;
    this.romBar.hidden = rom === null;
    this.romImport.disabled = !rom?.importable;
    this.romImport.title = rom?.importable ? "" : jaRomScript.notImportable;
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

/** フォルダの下の `.s`（下のフォルダも）。 */
async function listAsmFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await invoke<string[]>("fs_list", { path: dir }).catch(() => [] as string[])) {
    const path = `${dir}/${name}`;
    if (/\.s$/i.test(name)) out.push(path);
    else if ((await statFile(path).catch(() => null))?.dir) out.push(...(await listAsmFiles(path)));
  }
  return out;
}

/** 2 つの本文の、変わった範囲だけを置き換える変更（同じなら null）。 */
function minimalChange(before: string, after: string): { changes: { from: number; to: number; insert: string } } | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return { changes: { from: start, to: before.length - end, insert: after.slice(start, after.length - end) } };
}

/** ファイルの更新日時と大きさ（無ければ null）。 */
function statFile(path: string): Promise<FileStat | null> {
  return invoke<FileStat | null>("fs_stat", { path });
}
