import { invoke } from "@tauri-apps/api/core";
import { WORLD_MAP_WINDOW } from "./protocol";

/** AdvanceMap の TWeltkarteForm のクライアントの大きさ（683×345）に、幅/高さの行の 16px を足したもの。 */
const WIDTH = 683;
const HEIGHT = 361;

/**
 * ワールドマップエディターの別ウィンドウを開く（開いていれば前に出す）。
 * ウィンドウはメインウィンドウを親にし、大きさ固定で画面の中央に出す。中身は同じ index.html で、
 * main.ts がウィンドウのラベルを見てエディターを組み立てる。
 */
export async function openWorldMapWindow(title: string): Promise<void> {
  await invoke("open_tool_window", { label: WORLD_MAP_WINDOW, title, width: WIDTH, height: HEIGHT });
}
