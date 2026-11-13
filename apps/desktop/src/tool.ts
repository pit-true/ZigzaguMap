import "./styles/all";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { startToolWindow } from "./windows/world-map/startToolWindow";

/**
 * 別ウィンドウ（ワールドマップエディター・ブロックエディタ・パレットエディタ・ブロックパレット一括変更）の入口（tool.html）。
 * メインの画面（App）のコードは読み込まない（別ウィンドウのメモリを抑えるため。issue #108）。
 */
async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (root) await startToolWindow(getCurrentWebviewWindow().label, root);
}

void main();
