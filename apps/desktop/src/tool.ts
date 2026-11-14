import "./styles/all";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { startToolWindow } from "./windows/startToolWindow";
import { SCRIPT_EDITOR_WINDOW } from "./windows/script-editor/protocol";
import { followMainTheme } from "./util/theme";

/**
 * 別ウィンドウ（ワールドマップエディター・ブロックエディタ・パレットエディタ・ブロックパレット一括変更）の入口（tool.html）。
 * メインの画面（App）のコードは読み込まない（別ウィンドウのメモリを抑えるため。issue #108）。
 */
async function main(): Promise<void> {
  const label = getCurrentWebviewWindow().label;
  // 配色はメインの個人設定 `theme` に合わせる（スクリプトエディタは自分のテーマを持つので合わせない）。
  if (label !== SCRIPT_EDITOR_WINDOW) await followMainTheme();
  const root = document.getElementById("app");
  if (root) await startToolWindow(label, root);
}

void main();
