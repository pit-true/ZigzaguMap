import { clampBrushSize, toBrushShape, type BrushShape } from "@zigzagumap/core";
import type { BlockSelection, EditorState } from "./EditorState";

/**
 * 描く道具（Phase5 #388。Q1 の推奨）。マップタブと移動エリアタブの左ボタンで何をするかを決める。
 * - pencil（N）: 今までと同じ（ボタンと修飾キーの組で、置く・矩形塗り・入れ替えなどを選ぶ）。
 * - fill（B）: 塗りつぶし。Ctrl＋クリックでマジック塗り。
 * - shift（S）: マップシフト（ドラッグした量だけ配置全体をずらす）。
 * - select（M）: 範囲を選んで動かす（Phase7 #516。input/tools/SelectMoveTool）。
 * 右クリック（拾う）・Ctrl＋右ドラッグ（矩形の選択）・中ボタン（スクロール）は道具に関係なく今のまま。
 * 今の道具は個人設定 `paintTool` に覚える（両方のタブで同じ道具）。
 */
export type PaintTool = "pencil" | "fill" | "shift" | "select";

/** 帯の並びと、切り替えのキーの操作（キーは `app/keymap.ts` の表。既定は N・B・S。#392）。 */
export const PAINT_TOOLS: readonly { readonly id: PaintTool; readonly keyAction: string }[] = [
  { id: "pencil", keyAction: "tool.pencil" },
  { id: "fill", keyAction: "tool.fill" },
  { id: "shift", keyAction: "tool.shift" },
  { id: "select", keyAction: "tool.select" },
];

/** 個人設定の値を道具にする（知らない値は鉛筆）。 */
export function toPaintTool(value: unknown): PaintTool {
  return value === "fill" || value === "shift" || value === "select" ? value : "pencil";
}

/** 今の道具。 */
export function currentTool(state: EditorState): PaintTool {
  return toPaintTool(state.settings.data.paintTool);
}

/**
 * 押したときにする操作（マップタブと移動エリアタブで同じ振り分け。Phase5 の仕上げ #406 で 2 つのタブから 1 か所にまとめた）。
 * - 左ボタン: 道具が塗りつぶしなら `fill`、シフトなら `shift`（Ctrl を押していれば矩形塗り）。Alt は入れ替えが先
 *   （`canSwap` のときだけ。移動エリアタブには入れ替えが無いので Alt は見ない）。どれでもなければ鉛筆の `pencil`。
 *   選択（#516）なら `select`（Ctrl を押していれば矩形塗り、Alt は入れ替え。シフトと同じ）。
 * - 右ボタン: Ctrl を押していれば矩形の選択 `pick`。そうでなければ null（離したときに拾う）。
 */
export type PressKind = "fill" | "shift" | "select" | "rect" | "swap" | "pencil" | "pick" | null;

/** 押したボタンと修飾キー、今の道具から、する操作を決める。 */
export function pressKind(tool: PaintTool, g: { readonly button: number; readonly ctrl: boolean; readonly alt: boolean }, canSwap: boolean): PressKind {
  if (g.button !== 0) return g.ctrl ? "pick" : null;
  const alt = canSwap && g.alt;
  if (tool === "fill" && !alt) return "fill";
  if (tool === "shift" && !g.ctrl && !alt) return "shift";
  if (tool === "select" && !g.ctrl && !alt) return "select";
  if (g.ctrl) return "rect";
  if (alt) return "swap";
  return "pencil";
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

/** 鉛筆のブラシ（Phase7 #515。Q7 の推奨）。大きさ 1〜9 と形（正方形・円）。個人設定 `brushSize`・`brushShape` に覚える。 */
export interface Brush {
  readonly size: number;
  readonly shape: BrushShape;
}

/** 個人設定のブラシ（確かめて直した値）。 */
export function brushSetting(state: EditorState): Brush {
  return { size: clampBrushSize(state.settings.data.brushSize), shape: toBrushShape(state.settings.data.brushShape) };
}

/** ブラシを変えて個人設定に覚える（同じなら何もしない。変えたら true）。 */
export function setBrush(state: EditorState, patch: { size?: number; shape?: BrushShape }): boolean {
  const now = brushSetting(state);
  const size = patch.size === undefined ? now.size : clampBrushSize(patch.size);
  const shape = patch.shape === undefined ? now.shape : toBrushShape(patch.shape);
  if (size === now.size && shape === now.shape) return false;
  state.settings.update({ brushSize: size, brushShape: shape });
  state.emit("tool");
  return true;
}

/**
 * 鉛筆のブラシを使う選択か（1 ブロック。移動許可を持っていてもよい）。スタンプ（複数選択）は今のまま 1 回だけ置く。
 * 大きさ 1 なら null（今までと同じ描き方）。
 */
export function brushFor(state: EditorState, s: BlockSelection): Brush | null {
  const brush = brushSetting(state);
  return brush.size > 1 && s.width === 1 && s.height === 1 ? brush : null;
}
