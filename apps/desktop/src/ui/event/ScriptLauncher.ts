import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../../app/Settings";
import { hex, ja } from "../../i18n/ja";
import { showError } from "../MessageBox";

/** 起動した結果（自動操作の確認用）。 */
export interface LaunchRecord {
  readonly program: string;
  readonly args: readonly string[];
}

/**
 * 「スクリプトを開く」。設定したエディターを AdvanceMap と同じ引数で起動する:
 * `"<エディター>" "<ROM>" 16F884`（区切りは設定により空白か「:」。オフセットは 16 進 6 桁、$ なし）。
 * 起動は場所の設定タブと同じ launch_program。ROM のパスの引用符は Rust が付けるので、空白を含まないパスでは引用符が付かず、
 * 区切りが「:」のときは `"<ROM>:16F884"` の形になる（受け取る側の引数の分け方は AdvanceMap と同じ）。
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
    if (!(await invoke<boolean>("file_exists", { path: program }))) return void (await showError(ja.event.editorNotFound));
    const offset = hex(pointer & 0xffffff, 6);
    // 場所の設定タブの「スクリプトを開く」と同じく launch_program で起動する（引数の引用符は Rust が付ける）。
    const args = s.scriptSpaceSeparator ? [rom, offset] : [`${rom}:${offset}`];
    try {
      await invoke("launch_program", { program, args });
      this.last = { program, args };
    } catch {
      return void (await showError(ja.event.editorNotFound));
    }
  }
}
