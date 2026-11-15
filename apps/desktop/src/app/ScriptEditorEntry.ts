import { jaScriptEditor } from "../i18n/ja.scriptEditor";
import { ja } from "../i18n/ja";
import { messageBox } from "../ui/MessageBox";
import { installScriptEntry } from "../ui/script/ScriptEntry";
import type { ScriptHost } from "../ui/script/ScriptHost";
import type { App } from "./App";

/**
 * メインウィンドウ側の、スクリプトエディタ（別ウィンドウ）への入口。窓口の ScriptHost は初めて使うときに読み込む
 * （CodeMirror を含むエディタのコードはメインの起動で読まない）。「スクリプトを開く」の入口（ScriptEntry）への差し込みと、
 * 閉じる前の未保存の確認を受け持つ。
 */
export class ScriptEditorEntry {
  private value: Promise<ScriptHost> | null = null;

  constructor(private readonly app: App) {
    const show = (e: unknown): void => app.showError(e);
    installScriptEntry({
      available: () => app.state.session !== null,
      open: (target, pointer) => void this.host().then((h) => h.openTarget(target, pointer)).catch(show),
      openFile: (path, line) => void this.host().then((h) => h.openFile(path, line)).catch(show),
      openPointer: (pointer, target) => void this.host().then((h) => h.openRom(pointer, target)).catch(show),
    });
    // ツール > ビルド
    app.actions.register("tools.build", async () => (await this.host()).build());
  }

  /** 窓口（初めて呼ばれたときに読み込む）。 */
  host(): Promise<ScriptHost> {
    return (this.value ??= import("../ui/script/ScriptHost").then(({ ScriptHost }) => ScriptHost.get(this.app)));
  }

  /** 窓口（読み込み済みのときだけ。まだなら null）。 */
  async hostIfLoaded(): Promise<ScriptHost | null> {
    return this.value ? this.value.catch(() => null) : null;
  }

  /** エディタの未保存のファイル（読み込んでいない・調べられないときは空）。 */
  private async dirtyFiles(): Promise<string[]> {
    if (!this.value) return [];
    try {
      return await (await this.value).dirtyFiles();
    } catch {
      return [];
    }
  }

  /** エディタの未保存のファイルの数（聞かずに調べる。自動操作の `open`）。 */
  async dirtyCount(): Promise<number> {
    return (await this.dirtyFiles()).length;
  }

  /** エディタに未保存のファイルがあれば「保存しますか？」と聞く。続けてよければ true。 */
  async confirmUnsaved(): Promise<boolean> {
    const dirty = await this.dirtyFiles();
    if (dirty.length === 0) return true;
    const host = await this.value!;
    const answer = await messageBox(ja.question, jaScriptEditor.mainDirty(dirty.length), "warning", "yesNoCancel");
    if (answer === "cancel") return false;
    if (answer === "yes") return host.saveAll().catch(() => false);
    return true;
  }
}
