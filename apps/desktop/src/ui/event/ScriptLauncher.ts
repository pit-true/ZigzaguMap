import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../../app/Settings";
import { hex, ja } from "../../i18n/ja";
import { showMessage } from "../form/messageDialog";

/**
 * 個人設定のスクリプトエディターの項目（設定 > スクリプトエディターの選択 で決める）。
 * 設定画面は別の作業で作るので、ここでは読み取り口だけ合わせる（未設定なら null）。
 */
interface ScriptEditorSettings {
  readonly scriptEditor?: string | null;
  /** true なら ROM の名前とオフセットを空白で区切る（false・未設定なら「:」）。 */
  readonly scriptSpaceSeparator?: boolean;
}

/** 起動した結果（自動操作の確認用）。 */
export interface LaunchRecord {
  readonly program: string;
  readonly commandLine: string;
}

/**
 * 「スクリプトを開く」。設定したエディターを AdvanceMap と同じ引数で起動する:
 * `"<エディター>" "<ROM>" 16F884`（区切りは設定により空白か「:」。オフセットは 16 進 6 桁、$ なし）。
 * 未設定なら「スクリプトエディタが定義されていません！」、exe が無ければ「スクリプトエディタが見つかりません！」。
 */
export class ScriptLauncher {
  /** 最後に起動したもの。 */
  last: LaunchRecord | null = null;

  constructor(
    private readonly settings: Settings,
    private readonly romPath: () => string | null,
  ) {}

  async open(pointer: number): Promise<void> {
    const s = this.settings.data as unknown as ScriptEditorSettings;
    const program = s.scriptEditor ?? null;
    const rom = this.romPath();
    if (!program) return showMessage(ja.event.errorTitle, ja.event.editorUndefined);
    if (!rom) return;
    const offset = hex(pointer & 0xffffff, 6);
    const separator = s.scriptSpaceSeparator ? " " : ":";
    try {
      const commandLine = await invoke<string>("launch_script_editor", { program, rom, offset, separator });
      this.last = { program, commandLine };
    } catch {
      return showMessage(ja.event.errorTitle, ja.event.editorNotFound);
    }
  }
}
