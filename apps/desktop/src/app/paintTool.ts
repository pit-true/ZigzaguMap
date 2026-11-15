import type { EditorState } from "./EditorState";

/**
 * 描く道具（Phase5 #388。Q1 の推奨）。マップタブと移動エリアタブの左ボタンで何をするかを決める。
 * - pencil（N）: 今までと同じ（ボタンと修飾キーの組で、置く・矩形塗り・入れ替えなどを選ぶ）。
 * - fill（B）: 塗りつぶし。Ctrl＋クリックでマジック塗り。
 * - shift（S）: マップシフト（ドラッグした量だけ配置全体をずらす）。
 * 右クリック（拾う）・Ctrl＋右ドラッグ（矩形の選択）・中ボタン（スクロール）は道具に関係なく今のまま。
 * 今の道具は個人設定 `paintTool` に覚える（両方のタブで同じ道具）。
 */
export type PaintTool = "pencil" | "fill" | "shift";

/** 帯の並びと、切り替えのキーの操作（キーは `app/keymap.ts` の表。既定は N・B・S。#392）。 */
export const PAINT_TOOLS: readonly { readonly id: PaintTool; readonly keyAction: string }[] = [
  { id: "pencil", keyAction: "tool.pencil" },
  { id: "fill", keyAction: "tool.fill" },
  { id: "shift", keyAction: "tool.shift" },
];

/** 個人設定の値を道具にする（知らない値は鉛筆）。 */
export function toPaintTool(value: unknown): PaintTool {
  return value === "fill" || value === "shift" ? value : "pencil";
}

/** 今の道具。 */
export function currentTool(state: EditorState): PaintTool {
  return toPaintTool(state.settings.data.paintTool);
}

/** 道具を変えて個人設定に覚える（同じなら何もしない）。 */
export function setPaintTool(state: EditorState, tool: PaintTool): void {
  if (currentTool(state) === tool) return;
  state.settings.update({ paintTool: tool });
  state.emit("tool");
}

/** スマートパスのオン・オフを変える。 */
export function setSmartPath(state: EditorState, on: boolean): void {
  if (state.settings.data.smartPath === on) return;
  state.settings.update({ smartPath: on });
  state.emit("tool");
}
