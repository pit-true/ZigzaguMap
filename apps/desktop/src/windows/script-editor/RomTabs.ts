import { EditorState } from "@codemirror/state";
import { ja } from "../../i18n/ja";
import { jaRomScript } from "../../i18n/ja.romScript";
import { messageBox } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { EditorTab } from "./EditorTab";
import type { ScriptRomOpenRequest } from "./protocol";
import { openRomImportDialog } from "./RomImportDialog";
import type { ScriptEditorWindow } from "./ScriptEditorWindow";

/**
 * 素の ROM のスクリプトの読み取り専用のタブ（#206）と、「.s に取り込む」（#207）。
 * タブの上の帯（読み取り専用の印と取り込みのボタン）もここで持つ。
 */
export class RomTabs {
  /** ROM のタブの上の帯。 */
  readonly bar: HTMLElement;
  private readonly importButton: HTMLButtonElement;

  constructor(private readonly w: ScriptEditorWindow) {
    this.bar = document.createElement("div");
    this.bar.className = "se-rom-bar";
    this.bar.dataset["autoId"] = "se.romBar";
    this.bar.hidden = true;
    const note = document.createElement("span");
    note.textContent = jaRomScript.readOnly;
    this.importButton = document.createElement("button");
    this.importButton.type = "button";
    this.importButton.textContent = jaRomScript.importButton;
    this.importButton.dataset["autoId"] = "se.romImport";
    this.importButton.addEventListener("click", () => {
      const tab = this.w.active;
      if (tab?.rom) void this.import(tab);
    });
    this.bar.append(note, this.importButton);
  }

  /** ROM のスクリプトを読み取り専用のタブで開く（同じアドレスのタブがあれば中身を入れ替える）。 */
  open(req: ScriptRomOpenRequest): EditorTab {
    const w = this.w;
    let tab = w.tabs.find((x) => x.rom && x.path === req.key) ?? null;
    if (tab) {
      tab.rom = req;
      tab.state = w.createState(tab, req.text);
      tab.savedDoc = tab.state.doc;
      if (tab === w.active) w.view.setState(tab.state);
    } else {
      tab = new EditorTab(req.key, "asm", EditorState.create({ doc: "" }), "\n", false, null);
      tab.rom = req;
      tab.state = w.createState(tab, req.text);
      tab.savedDoc = tab.state.doc;
      w.tabs.push(tab);
    }
    w.activate(tab);
    w.render();
    return tab;
  }

  /** 「.s に取り込む」: 付ける名前を一覧で確かめてから、メインで取り込む。`rename` を渡すと一覧を出さない（自動操作）。 */
  async import(tab: EditorTab, rename?: Record<string, string>): Promise<unknown> {
    const rom = tab.rom;
    if (!rom) return null;
    if (!rom.importable || !rom.target) {
      this.w.setMessage(jaRomScript.notImportable);
      return null;
    }
    const chosen = rename ?? (await openRomImportDialog(rom));
    if (!chosen) return null;
    try {
      const plan = await this.w.client.request({ type: "importRom", pointer: rom.pointer, target: rom.target, rename: chosen });
      this.w.setMessage(jaRomScript.importDone(plan.entryLabel));
      return plan;
    } catch (e) {
      this.w.setMessage(jaRomScript.importFailed(errorText(e)));
      await messageBox(ja.errorTitle, jaRomScript.importFailed(errorText(e)), "error");
      return null;
    }
  }

  /** 帯を表示中のタブに合わせる。 */
  render(active: EditorTab | null): void {
    const rom = active?.rom ?? null;
    this.bar.hidden = rom === null;
    this.importButton.disabled = !rom?.importable;
    this.importButton.title = rom?.importable ? "" : jaRomScript.notImportable;
  }
}
