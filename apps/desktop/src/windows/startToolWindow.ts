import { WORLD_MAP_WINDOW } from "./world-map/protocol";

/** 別ウィンドウの中身を組み立てる関数（そのウィンドウのコードは、ここで初めて読み込む）。 */
type ToolWindowStarter = (label: string, root: HTMLElement) => Promise<void>;

/** ブロックエディタ・パレットエディタ・ブロックパレット一括変更（メインとは ToolWindowHost / ToolClient でやり取りする）。 */
const startBlockTool: ToolWindowStarter = async (label, root) => {
  const { startBlockTool } = await import("./startBlockTool");
  await startBlockTool(label as Parameters<typeof startBlockTool>[0], root);
};

/**
 * 別ウィンドウ（Tauri のウィンドウのラベル）→ 中身の組み立て方。
 * 新しい別ウィンドウを足すときは、ここと、Rust の capabilities/default.json の `windows` に足す。
 */
const TOOL_WINDOWS: Readonly<Record<string, ToolWindowStarter>> = {
  [WORLD_MAP_WINDOW]: async (_label, root) => {
    const { WorldMapWindow } = await import("./world-map/WorldMapWindow");
    await new WorldMapWindow(root).start();
  },
  "block-editor": startBlockTool,
  "palette-editor": startBlockTool,
  "block-adjust": startBlockTool,
};

/** 別ウィンドウ（メイン以外）の中身を、ウィンドウのラベルで選んで組み立てる（tool.ts から呼ぶ）。 */
export async function startToolWindow(label: string, root: HTMLElement): Promise<void> {
  const start = TOOL_WINDOWS[label];
  if (start) await start(label, root);
  else root.textContent = `知らないウィンドウです: ${label}`;
}
