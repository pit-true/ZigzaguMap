import type { BlockUsageService } from "../../app/BlockUsageService";
import type { EditorState, TabId } from "../../app/EditorState";
import { ctrlPeek } from "../map/ctrlPeek";
import type { MapView } from "../map/MapView";

/** 印の色。 */
const MISMATCH_COLOR = "#ffd400";
const MOVEMENT_COLOR = "#ff00ff";

/**
 * 使用の印（#235。表示 > 移動許可の強調、個人設定 `usageMarks`、既定オン）。主マップの重ね描きの上に別の Canvas で描く。
 * - マップタブ: ブロックを 1 つ選んでいるとき、同じブロックなのに移動許可が全マップでいちばん多い値と違うマスを黄色の枠で囲む。
 * - 移動エリアタブ: 選んでいる移動許可の値のマスを桃色の枠で囲む。
 * Ctrl を押している間（#238）は描かない。画像に撮るとき（canvasPng）には入らない。
 */
export class UsageMarks {
  private readonly canvas: HTMLCanvasElement;
  /** 最後に描いた印のマス（自動操作の `blockUsage`）。 */
  marked: { x: number; y: number }[] = [];

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly tab: TabId,
    private readonly usage: BlockUsageService,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "usage-marks";
    view.stage.append(this.canvas);
    const redraw = (): void => this.draw();
    for (const topic of ["map", "cells", "selection", "movement", "view", "tab"] as const) state.on(topic, redraw);
    usage.onChange(redraw);
    ctrlPeek.on(redraw);
  }

  /** 印を付けるマスを求める（表示とは別に、自動操作からも呼ぶ）。 */
  cells(): { x: number; y: number }[] {
    const map = this.state.map;
    if (!map || !this.state.settings.data.usageMarks) return [];
    const grid = map.doc.grid;
    const out: { x: number; y: number }[] = [];
    if (this.tab === "movement") {
      const value = this.state.movement;
      for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i]! >> 10 === value) out.push({ x: i % grid.width, y: Math.floor(i / grid.width) });
      return out;
    }
    const s = this.state.selection;
    const usage = this.usage.ready;
    if (!usage || s.width !== 1 || s.height !== 1) return [];
    const block = s.blocks[0] ?? 0;
    const most = usage.mostMovement(block, map.doc.primaryTileset, map.doc.secondaryTileset);
    if (most === null) return [];
    for (let i = 0; i < grid.cells.length; i++) {
      const v = grid.cells[i]!;
      if ((v & 0x3ff) === block && v >> 10 !== most) out.push({ x: i % grid.width, y: Math.floor(i / grid.width) });
    }
    return out;
  }

  private draw(): void {
    const layer = this.view.layer;
    const c = this.canvas;
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
    this.marked = this.state.tab === this.tab && !ctrlPeek.held ? this.cells() : [];
    if (this.marked.length === 0) return;
    const size = this.view.cellSize;
    ctx.strokeStyle = this.tab === "movement" ? MOVEMENT_COLOR : MISMATCH_COLOR;
    ctx.lineWidth = 2;
    for (const { x, y } of this.marked) ctx.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
  }
}
