import { invoke } from "@tauri-apps/api/core";
import { ja } from "../../i18n/ja";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import { openDialogs } from "../../ui/Dialog";
import { messageBox } from "../../ui/MessageBox";
import { sameStat, statFile, type EditorTab, type FileStat } from "./EditorTab";
import { decodeScriptText, type DecodedText } from "./fileText";
import type { ScriptEditorWindow } from "./ScriptEditorWindow";
import { minimalChange } from "./textChange";

/**
 * 外部の変更の見張り。開いているファイルの `fs_stat` を 1 秒ごとと、ウィンドウが前面に戻ったときに調べる。
 * 未保存の変更が無ければ黙って読み直し（カーソルは残る）、あれば「読み直しますか？」と聞く。消えたら印を付ける。
 */
export class ExternalChanges {
  private checking = false;

  constructor(private readonly w: ScriptEditorWindow) {}

  /** 開いているファイルが外部で変わっていないか調べる（1 秒ごとと、前面に戻ったとき）。 */
  async check(): Promise<void> {
    if (this.checking || this.w.isClosing || openDialogs.length > 0) return;
    this.checking = true;
    try {
      for (const tab of [...this.w.tabs]) {
        if (tab.saving || tab.rom || !this.w.tabs.includes(tab)) continue;
        await this.checkTab(tab);
      }
    } finally {
      this.checking = false;
    }
  }

  private async checkTab(tab: EditorTab): Promise<void> {
    const w = this.w;
    let stat: FileStat | null;
    try {
      stat = await statFile(tab.path);
    } catch {
      return;
    }
    if (!stat) {
      if (!tab.missing) {
        tab.missing = true;
        w.setMessage(t.deleted(tab.path));
        w.render();
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
      w.render();
      return;
    }
    if (tab.dirty) {
      w.activate(tab);
      const answer = await messageBox(ja.question, t.confirmReload(tab.name), "warning", "yesNo");
      if (answer !== "yes" || !w.tabs.includes(tab)) return;
    }
    this.replaceText(tab, decoded);
    w.setMessage(t.reloaded(tab.path));
  }

  /**
   * 本文をディスクの内容に置き換える。変わった範囲だけを置き換えるので、カーソルと選択は同じ場所に残る。
   * 置き換えは履歴に入る（Ctrl+Z で読み直す前に戻せる）。
   */
  private replaceText(tab: EditorTab, decoded: DecodedText): void {
    const spec = minimalChange(tab.state.doc.toString(), decoded.text);
    if (spec) this.w.dispatchTo(tab, spec);
    tab.savedDoc = tab.state.doc;
    tab.lineEnding = decoded.lineEnding;
    tab.bom = decoded.bom;
    this.w.render();
  }
}
