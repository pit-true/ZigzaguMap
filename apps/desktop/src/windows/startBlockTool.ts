import "../styles/tool.css";
import { messageBox } from "../ui/MessageBox";
import { ja } from "../i18n/ja";
import type { ToolKind } from "./protocol";
import { ToolClient } from "./ToolClient";

/**
 * ブロックエディタ・パレットエディタ・ブロックパレット一括変更のウィンドウの入口（main.ts → startToolWindow から呼ばれる）。
 * ウィンドウのラベルで中身を選び、その部分のコードだけを読み込む。状態はメインウィンドウが持つので、ここでは接続して写しを受け取るだけ。
 */
export async function startBlockTool(kind: ToolKind, root: HTMLElement): Promise<void> {
  root.classList.add("tool-app");
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
      (await import("./block-editor/BlockEditorWindow")).BlockEditorWindow.start(root, client);
      break;
    case "palette-editor":
      (await import("./palette-editor/PaletteEditorWindow")).PaletteEditorWindow.start(root, client);
      break;
    case "block-adjust":
      (await import("./block-adjust/BlockAdjustWindow")).BlockAdjustWindow.start(root, client);
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

