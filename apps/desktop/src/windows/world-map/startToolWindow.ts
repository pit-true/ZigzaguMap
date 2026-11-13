import { WORLD_MAP_WINDOW } from "./protocol";

/**
 * 道具のウィンドウ（メイン以外）の中身を組み立てる入口。main.ts がウィンドウのラベルで呼び分ける。
 * ワールドマップエディターと、ブロックエディタ・パレットエディタ・ブロックパレット一括変更。
 */
export async function startToolWindow(label: string, root: HTMLElement): Promise<void> {
  if (label === WORLD_MAP_WINDOW) {
    const { WorldMapWindow } = await import("./WorldMapWindow");
    await new WorldMapWindow(root).start();
    return;
  }
  if (label === "block-editor" || label === "palette-editor" || label === "block-adjust") {
    const { startBlockTool } = await import("../startBlockTool");
    await startBlockTool(label, root);
    return;
  }
  root.textContent = `知らないウィンドウです: ${label}`;
}
