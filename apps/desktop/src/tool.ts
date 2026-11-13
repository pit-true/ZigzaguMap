import "./styles/base.css";
import "./styles/menu.css";
import "./styles/dialog.css";
import "./styles/amform.css";
import "./styles/tool.css";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { messageBox } from "./ui/MessageBox";
import { ja } from "./i18n/ja";
import type { ToolKind } from "./windows/protocol";
import { ToolClient } from "./windows/ToolClient";

/**
 * 別ウィンドウ（tool.html）の入口。ウィンドウのラベルで中身を選び、その部分のコードだけを読み込む。
 * 状態はメインウィンドウが持つので、ここでは接続して写しを受け取るだけ。
 */
async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  const kind = getCurrentWebviewWindow().label as ToolKind;
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  let client: ToolClient;
  try {
    client = await ToolClient.connect(kind);
  } catch (e) {
    await messageBox(ja.errorTitle, e instanceof Error ? e.message : String(e), "error");
    return;
  }
  installKeys(client);
  switch (kind) {
    case "block-editor":
      (await import("./windows/block-editor/BlockEditorWindow")).BlockEditorWindow.start(root, client);
      break;
    case "palette-editor":
      (await import("./windows/palette-editor/PaletteEditorWindow")).PaletteEditorWindow.start(root, client);
      break;
    case "block-adjust":
      (await import("./windows/block-adjust/BlockAdjustWindow")).BlockAdjustWindow.start(root, client);
      break;
  }
}

/** Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z）はメインと同じ履歴の元に戻す・やり直す、Ctrl+S は出力。入力欄の中では反応しない。 */
function installKeys(client: ToolClient): void {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || !e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    const key = e.key.toUpperCase();
    if (key === "Z" && !e.shiftKey) void client.request({ op: "undo" });
    else if (key === "Y" || (key === "Z" && e.shiftKey)) void client.request({ op: "redo" });
    else if (key === "S") void client.request({ op: "export" });
    else return;
    e.preventDefault();
  });
}

void main();
