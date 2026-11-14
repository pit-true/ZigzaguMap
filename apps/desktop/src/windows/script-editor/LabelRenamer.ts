import { invoke } from "@tauri-apps/api/core";
import { detectLabelRename, indexAsmFile, isScriptLabelName, renameLabelInText } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import { inputDialog } from "../../ui/InputDialog";
import { messageBox } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { statFile, type EditorTab } from "./EditorTab";
import { decodeScriptText, encodeScriptText } from "./fileText";
import type { ScriptEditorWindow } from "./ScriptEditorWindow";
import { minimalChange } from "./textChange";

/** ラベル名を変える `.s` のフォルダ。 */
const RENAME_DIR = "assembly/overworld_scripts";

/** ラベル名の変更（#203）。F2 で名前を変えるのと、保存のときに手で書き換えたラベルを見つけるのと。 */
export class LabelRenamer {
  constructor(private readonly w: ScriptEditorWindow) {}

  /**
   * ラベル名を変える（F2）。`assembly/overworld_scripts` の下のすべての `.s` の定義と参照を変え（開いているタブは本文を、
   * 開いていないファイルはディスクを書き換える）、メインへ知らせる（メインはイベントと eventscripts の側を変えるコマンドを実行する）。
   * `to` を渡すと名前を聞かない（自動操作）。変えた数を返す。
   */
  async rename(from: string, to?: string): Promise<{ count: number; files: string[]; uses: number } | null> {
    const w = this.w;
    const next = to ?? (await inputDialog(t.renameTitle, t.renamePrompt(from), from));
    if (next === null || next === from) return null;
    if (!isScriptLabelName(next)) {
      await messageBox(ja.errorTitle, t.renameInvalid(next), "error");
      return null;
    }
    let count = 0;
    const files: string[] = [];
    for (const path of await listAsmFiles(RENAME_DIR)) {
      const tab = w.findTab(path);
      try {
        if (tab) {
          const r = renameLabelInText(tab.state.doc.toString(), from, next);
          if (r.count === 0) continue;
          const spec = minimalChange(tab.state.doc.toString(), r.text)!;
          w.dispatchTo(tab, { ...spec, userEvent: "input.rename" });
          count += r.count;
        } else {
          const decoded = decodeScriptText(await invoke<string>("fs_read_text", { path }));
          const r = renameLabelInText(decoded.text, from, next);
          if (r.count === 0) continue;
          await invoke("fs_write_text", { path, text: encodeScriptText(r.text, decoded.lineEnding, decoded.bom) });
          w.client.saved(path);
          void w.project.reloadFile(path);
          count += r.count;
        }
        files.push(path);
      } catch (e) {
        await messageBox(ja.errorTitle, t.saveFailed(path, errorText(e)), "error");
      }
    }
    w.render();
    const uses = Number(await w.client.request({ type: "labelRenamed", from, to: next, path: w.active?.path ?? "" }).catch(() => 0));
    w.setMessage(t.renamed(from, next, count, files.length, uses));
    return { count, files, uses };
  }

  /** 保存するとき、手で書き換えたラベルが 1 つだけなら（消えた 1 つと増えた 1 つ）、イベントのラベルも変えるか聞く。 */
  async checkManualRename(tab: EditorTab, before: string, after: string): Promise<void> {
    if (tab.kind !== "asm") return;
    const w = this.w;
    const names = (text: string): string[] => indexAsmFile(tab.path, text).labels.map((l) => l.name);
    const found = detectLabelRename(names(before), names(after));
    if (!found) return;
    const uses = Number(await w.client.request({ type: "labelUses", label: found.from }).catch(() => 0));
    if (uses === 0) return;
    const answer = await messageBox(ja.question, t.confirmRename(found.from, found.to, uses), "question", "yesNo");
    if (answer !== "yes") return;
    const n = Number(await w.client.request({ type: "labelRenamed", from: found.from, to: found.to, path: tab.path }).catch(() => 0));
    w.setMessage(t.renamed(found.from, found.to, 0, 0, n));
  }
}

/** フォルダの下の `.s`（下のフォルダも。フォルダかどうかは `fs_stat` で見る）。 */
async function listAsmFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await invoke<string[]>("fs_list", { path: dir }).catch(() => [] as string[])) {
    const path = `${dir}/${name}`;
    if (/\.s$/i.test(name)) out.push(path);
    else if ((await statFile(path).catch(() => null))?.dir) out.push(...(await listAsmFiles(path)));
  }
  return out;
}
