import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../../app/Settings";
import { hex, ja } from "../../i18n/ja";
import { showError } from "../MessageBox";

/** 起動した結果（自動操作の確認用）。 */
export interface LaunchRecord {
  readonly program: string;
  readonly commandLine: string;
}

/**
 * 「スクリプトを開く」。設定したエディターを AdvanceMap と同じ引数で起動する:
 * `"<エディター>" "<ROM>" 16F884`（区切りは設定により空白か「:」。オフセットは 16 進 6 桁、$ なし）。
 * エディターは 設定 > スクリプトエディターの選択 で決める。未設定なら「スクリプトエディタが定義されていません！」、exe が無ければ「スクリプトエディタが見つかりません！」。
 */
export class ScriptLauncher {
  /** 最後に起動したもの。 */
  last: LaunchRecord | null = null;

  constructor(
    private readonly settings: Settings,
    private readonly romPath: () => string | null,
  ) {}

  async open(pointer: number): Promise<void> {
    const s = this.settings.data;
    const program = s.scriptEditor;
    const rom = this.romPath();
    if (!program) return void (await showError(ja.event.editorUndefined));
    if (!rom) return;
    const offset = hex(pointer & 0xffffff, 6);
    const separator = s.scriptSpaceSeparator ? " " : ":";
    try {
      const commandLine = await invoke<string>("launch_script_editor", { program, rom, offset, separator });
      this.last = { program, commandLine };
    } catch {
      return void (await showError(ja.event.editorNotFound));
    }
  }
}
