/** マス（主マップの左上が原点）。 */
interface Cell {
  readonly x: number;
  readonly y: number;
}

/** ルーラーの色（Phase5 #400）。 */
const RULER_COLOR = "#00e0ff";
const RULER_EDGE = "#003040";

/**
 * ルーラー（Phase5 #400。Q11 の推奨: イベントタブで Shift＋右ドラッグの間だけ出す）。
 * 押したマスから今のマスへ線を引き、両端のマスと、2 つを囲む矩形に枠を付ける。横と縦のマス数は呼ぶ側がステータスバーに出す。
 * 描く先はイベントタブの重ね描き（イベントの印と同じ Canvas）で、MapView には触らない。
 */
export class Ruler {
  private from: Cell | null = null;
  private to: Cell | null = null;

  /** 出しているか。 */
  get active(): boolean {
    return this.from !== null;
  }

  /** 押したマスから始める。 */
  start(cell: Cell): void {
    this.from = cell;
    this.to = cell;
  }

  /** 今のマスへ伸ばす。 */
  move(cell: Cell): void {
    if (this.from) this.to = cell;
  }

  /** やめる。動かしたか（押したマスと別のマスまで伸ばしたか）を返す。 */
  stop(): boolean {
    const moved = !!this.from && !!this.to && (this.from.x !== this.to.x || this.from.y !== this.to.y);
    this.from = null;
    this.to = null;
    return moved;
  }

  /** 横と縦のマス数（離れているマスの数。同じマスなら 0）。出していなければ null。 */
  distance(): { dx: number; dy: number } | null {
    if (!this.from || !this.to) return null;
    return { dx: Math.abs(this.to.x - this.from.x), dy: Math.abs(this.to.y - this.from.y) };
  }

  /** 重ね描きに描く。 */
  draw(canvas: HTMLCanvasElement, cellSize: number): void {
    const a = this.from;
    const b = this.to;
    if (!a || !b) return;
    const c = canvas.getContext("2d")!;
    const w = Math.max(1, cellSize / 16);
    c.save();
    c.globalAlpha = 1;
    // 2 つを囲む矩形（点線）
    const x0 = Math.min(a.x, b.x) * cellSize;
    const y0 = Math.min(a.y, b.y) * cellSize;
    const rw = (Math.abs(a.x - b.x) + 1) * cellSize;
    const rh = (Math.abs(a.y - b.y) + 1) * cellSize;
    c.lineWidth = w;
    c.setLineDash([4 * w, 3 * w]);
    c.strokeStyle = RULER_COLOR;
    c.strokeRect(x0 + w / 2, y0 + w / 2, rw - w, rh - w);
    c.setLineDash([]);
    // 両端のマス
    for (const p of [a, b]) {
      c.strokeStyle = RULER_EDGE;
      c.lineWidth = w * 3;
      c.strokeRect(p.x * cellSize + w * 1.5, p.y * cellSize + w * 1.5, cellSize - w * 3, cellSize - w * 3);
      c.strokeStyle = RULER_COLOR;
      c.lineWidth = w;
      c.strokeRect(p.x * cellSize + w * 1.5, p.y * cellSize + w * 1.5, cellSize - w * 3, cellSize - w * 3);
    }
    // 中心どうしを結ぶ線（縁取りつき）
    const half = cellSize / 2;
    for (const [color, width] of [
      [RULER_EDGE, w * 3],
      [RULER_COLOR, w],
    ] as const) {
      c.beginPath();
      c.moveTo(a.x * cellSize + half, a.y * cellSize + half);
      c.lineTo(b.x * cellSize + half, b.y * cellSize + half);
      c.strokeStyle = color;
      c.lineWidth = width;
      c.stroke();
    }
    c.restore();
  }
}
