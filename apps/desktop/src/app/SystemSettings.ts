import { invoke } from "@tauri-apps/api/core";
import { ja } from "../i18n/ja";
import { askYesNo, showError, showInfo } from "../ui/MessageBox";
import type { EditorState } from "./EditorState";
import { fileExists, fileNameOf, folderOf, type FileDialogs } from "./FileDialogs";

/**
 * PC 全体に関わる設定と、外部プログラムの設定。
 * - スクリプトエディターの選択（exe と、オフセットの区切り）
 * - エクスプローラーの右クリックへの登録、デスクトップのショートカット、最後に開いた ROM のショートカット
 *   （どれも実行の前に確認する。自動操作で起動したときは、確認で「はい」でも実行しない）
 * - ROM へ書き込まない ZigzaguMap では意味の無い項目（バックアップ、ダミーデータ）の案内
 */
export class SystemSettings {
  constructor(
    private readonly state: EditorState,
    private readonly files: FileDialogs,
    /** 自動操作で起動したか。 */
    private readonly automation: () => boolean,
  ) {}

  /** 設定 > スクリプトエディターの選択。 */
  async chooseScriptEditor(): Promise<void> {
    const settings = this.state.settings;
    const current = settings.data.scriptEditor;
    const path = await this.files.openFile({
      title: ja.openFileTitle,
      filters: [{ name: ja.programFilter, extensions: ["exe"] }],
      directory: current ? folderOf(current) : null,
      fileName: current ? fileNameOf(current) : null,
    });
    if (!path) return;
    if (!/\.exe$/i.test(path) || !(await fileExists(path))) return void (await showError(ja.notExeFile));
    const colon = await askYesNo(ja.scriptSeparatorQuestion);
    settings.update({ scriptEditor: path, scriptSpaceSeparator: !colon });
    this.state.setStatus(ja.scriptEditorSet(path));
  }

  /** 設定 > コンテキストメニューにAM context menuを追加する（もう一度押すと外す）。 */
  async toggleContextMenu(): Promise<void> {
    const on = this.state.settings.data.contextMenu;
    if (!(await askYesNo(on ? ja.contextMenuRemoveQuestion : ja.contextMenuAddQuestion))) return;
    if (this.skipForAutomation()) return;
    try {
      if (on) await invoke("unregister_context_menu");
      else await invoke("register_context_menu", { label: ja.contextMenuLabel });
      this.state.settings.update({ contextMenu: !on });
      this.state.emit("view");
    } catch (e) {
      await showError(String(e));
    }
  }

  /** ツール > デスクトップにショートカットを作成。 */
  async createDesktopShortcut(): Promise<void> {
    if (!(await askYesNo(ja.desktopShortcutQuestion))) return;
    if (this.skipForAutomation()) return;
    try {
      const exe = await invoke<string>("exe_path");
      const desktop = await invoke<string>("desktop_dir");
      await invoke("create_shortcut", { link: `${desktop}\\${ja.appTitle}.lnk`, target: exe, arguments: "" });
      this.state.setStatus(ja.desktopShortcutCreated);
    } catch (e) {
      await showError(String(e));
    }
  }

  /** 設定 > 最後に開いたROMのショートカットを作成する（オンにするときに確認する）。 */
  async toggleRomShortcut(): Promise<void> {
    const settings = this.state.settings;
    if (settings.data.romShortcut) {
      settings.update({ romShortcut: false });
    } else {
      if (!(await askYesNo(ja.romShortcutQuestion))) return;
      settings.update({ romShortcut: true });
      const rom = this.state.session?.romPath;
      if (rom) await this.updateRomShortcut(rom);
    }
    this.state.emit("view");
  }

  /** ROM を開いたあと: 設定がオンなら、exe と同じフォルダのショートカットをその ROM に向け直す。 */
  async updateRomShortcut(rom: string): Promise<void> {
    if (!this.state.settings.data.romShortcut || this.automation()) return;
    try {
      const exe = await invoke<string>("exe_path");
      await invoke("create_shortcut", { link: `${folderOf(exe)}\\${ja.romShortcutName}.gba.lnk`, target: rom, arguments: "" });
    } catch (e) {
      this.state.setStatus(ja.error(String(e)), undefined, true);
    }
  }

  /** ROM へ書き込まないため意味の無い項目。 */
  notNeeded(): Promise<unknown> {
    return showInfo(ja.notNeededWithoutRomWrite);
  }

  /** 自動操作のときは PC に手を入れない（ステータスバーに出すだけ）。 */
  private skipForAutomation(): boolean {
    if (!this.automation()) return false;
    this.state.setStatus(ja.skippedInAutomation);
    return true;
  }
}
