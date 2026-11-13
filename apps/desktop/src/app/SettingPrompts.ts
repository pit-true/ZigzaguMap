import { ja } from "../i18n/ja";
import { inputDialog } from "../ui/InputDialog";
import { showError } from "../ui/MessageBox";
import type { EditorState } from "./EditorState";
import type { SettingsData } from "./Settings";

/**
 * 数を入力して変える設定（設定メニューの入力ダイアログ）。
 * 数でない入力は AdvanceMap と同じ「'…' is not a valid integer value.」、範囲外は「無効な値が入力されました！…」を出す。
 */
export class SettingPrompts {
  constructor(
    private readonly state: EditorState,
    /** 設定を変えて画面に反映する（App.changeSetting）。 */
    private readonly change: (patch: Partial<SettingsData>) => void,
  ) {}

  /** 設定 > マップブロックの横幅（Ctrl+P）。0 は AdvanceMap では「Division by zero.」になるが、入力エラーにする。 */
  async paletteWidth(): Promise<void> {
    const text = await inputDialog(ja.blockWidthTitle, ja.blockWidthPrompt, String(this.state.settings.data.paletteWidth));
    if (text === null) return;
    const n = parseDelphiInteger(text);
    if (n === null) return void (await showError(ja.invalidInteger(text), ja.appTitle));
    if (n < 1 || n > 64) return void (await showError(ja.invalidInput));
    this.change({ paletteWidth: n });
  }

  /** 設定 > 移動エリアの設定の透明度。 */
  async opacity(): Promise<void> {
    const text = await inputDialog(ja.movementOpacity, ja.opacityPrompt, String(this.state.settings.data.movementOpacity));
    if (text === null) return;
    const n = Number(text.trim().replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(n) || n < 0 || n > 1) return void (await showError(ja.invalidInput));
    this.change({ movementOpacity: n });
  }

  /** 設定 > 最近開いたファイルの設定 > 最近開いたファイルリストの最大数の変更。 */
  async recentMax(): Promise<void> {
    const text = await inputDialog(ja.recentMax, ja.recentMaxPrompt, String(this.state.settings.data.recentMax));
    if (text === null) return;
    const n = parseDelphiInteger(text);
    if (n === null) return void (await showError(ja.invalidInteger(text), ja.appTitle));
    if (n < 1 || n > 9) return void (await showError(ja.invalidInput));
    this.change({ recentMax: n, recent: this.state.settings.data.recent.slice(0, n) });
  }
}

/** 前後の空白を除いた 10 進の整数だけを受け付ける（読めなければ null）。 */
function parseDelphiInteger(text: string): number | null {
  return /^\s*[+-]?\d+\s*$/.test(text) ? Number(text) : null;
}
