import { invoke } from "@tauri-apps/api/core";
import type { EditorState } from "../../app/EditorState";
import { jaMapExport as t } from "../../i18n/ja.mapExport";
import { errorText } from "../../util/errors";

/**
 * 画像を書き出したあとにステータスバーに出す「フォルダを開く」（Phase7 #514）。押すと、書いたファイルを選んだ状態で
 * エクスプローラーを開く。別のマップを開くか ROM を開き直すと隠す。
 */
export class FolderNotice {
  readonly element: HTMLButtonElement;
  /** 今出しているファイル（隠していれば null）。 */
  path: string | null = null;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "status-panel";
    this.element.dataset["autoId"] = "status.openFolder";
    this.element.textContent = t.openFolder;
    this.element.hidden = true;
    this.element.addEventListener("click", () => void this.open());
    for (const topic of ["map", "session"] as const) state.on(topic, () => this.hide());
  }

  /** 書いたファイルを覚えて出す。 */
  show(path: string): void {
    this.path = path;
    this.element.title = path;
    this.element.hidden = false;
  }

  hide(): void {
    this.path = null;
    this.element.hidden = true;
  }

  /** エクスプローラーで開く（押したのと同じ）。 */
  async open(): Promise<boolean> {
    if (!this.path) return false;
    try {
      await invoke("reveal_file", { path: this.path });
      return true;
    } catch (e) {
      this.state.setStatus(errorText(e), undefined, true);
      return false;
    }
  }
}
