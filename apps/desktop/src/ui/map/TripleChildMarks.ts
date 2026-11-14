import type { EditorState } from "../../app/EditorState";
import { ctrlPeek } from "./ctrlPeek";
import type { MapView } from "./MapView";

/** 印の色。 */
const COLOR = "#00c8ff";

/**
 * 3 層の次の番号が置かれているマスの印（#301。表示 > 3層の3枚目のブロックに印を付ける、個人設定 `tripleChildMarks`、既定オン）。
 * そのマスは実機と同じくそのブロック自身として描かれる（マップは変えない）。直す場所が分かるよう、点線の枠で囲む。
 * Ctrl を押している間は描かない。画像に撮るとき（canvasPng）には入らない。マップタブの主マップだけ。
 */
export class TripleChildMarks {
  private readonly canvas: HTMLCanvasElement;
  /** 最後に描いた印のマス（自動操作の `tripleChildCells`）。 */
  marked: { x: number; y: number }[] = [];

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "usage-marks";
    view.stage.append(this.canvas);
    const redraw = (): void => this.draw();
    for (const topic of ["map", "cells", "tiles", "view", "tab"] as const) state.on(topic, redraw);
    ctrlPeek.on(redraw);
  }

  /** 今のマップで、3 層の次の番号が置かれているマス（表示の設定に関係なく求める）。 */
  cells(): { x: number; y: number }[] {
    const map = this.state.map;
    if (!map) return [];
    const grid = map.doc.grid;
    const triple = map.tiles.triple;
    const out: { x: number; y: number }[] = [];
    const memo = new Map<number, boolean>();
    for (let i = 0; i < grid.cells.length; i++) {
      const b = grid.cells[i]! & 0x3ff;
      let child = memo.get(b);
      if (child === undefined) memo.set(b, (child = triple.isTripleChild(b)));
      if (child) out.push({ x: i % grid.width, y: Math.floor(i / grid.width) });
    }
    return out;
  }

  private draw(): void {
    const layer = this.view.layer;
    const c = this.canvas;
    const on = this.state.settings.data.tripleChildMarks && this.state.tab === "map" && !ctrlPeek.held;
    this.marked = on ? this.cells() : [];
    // 印が無いときは Canvas の領域を持たない（3 層の次の番号はふつうのマップに無いので、メモリを使わない）
    if (this.marked.length === 0) {
      if (c.width !== 0) c.width = c.height = 0;
      return;
    }
    c.style.left = layer.style.left;
    c.style.top = layer.style.top;
    c.style.width = layer.style.width;
    c.style.height = layer.style.height;
    if (c.width !== layer.width || c.height !== layer.height) {
      c.width = layer.width;
      c.height = layer.height;
    }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    const size = this.view.cellSize;
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 2]);
    for (const { x, y } of this.marked) ctx.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
  }
}
