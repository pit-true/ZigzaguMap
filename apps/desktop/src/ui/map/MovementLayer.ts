import { MOVEMENT_SHIFT, type BlockGrid } from "@zigzagumap/core";
import { MOVEMENT_COLORS, movementLabel } from "../../app/data/movementColors";

/**
 * 移動許可の重ね描き（値ごとの色を半透明で塗り、値を 16 進で中央に書く）。
 * 描いた値を覚えておき、変わったマスだけ描き直す。
 */
export class MovementLayer {
  private drawn: Int16Array | null = null;
  private grid: BlockGrid | null = null;
  private cellSize = 16;
  private opacity = 0.3;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** マップと表示の設定を変え、全体を描き直す。 */
  reset(grid: BlockGrid | null, cellSize: number, opacity: number): void {
    this.grid = grid;
    this.cellSize = cellSize;
    this.opacity = opacity;
    this.drawn = grid ? new Int16Array(grid.width * grid.height).fill(-1) : null;
    const c = this.canvas.getContext("2d")!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.update();
  }

  /** 変わったマスを描き直す。 */
  update(): void {
    const grid = this.grid;
    const drawn = this.drawn;
    if (!grid || !drawn) return;
    const c = this.canvas.getContext("2d")!;
    const size = this.cellSize;
    c.font = `${Math.round(size * 0.6)}px "MS UI Gothic", sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    const cells = grid.cells;
    for (let i = 0; i < cells.length; i++) {
      const value = cells[i]! >> MOVEMENT_SHIFT;
      if (drawn[i] === value) continue;
      drawn[i] = value;
      const x = (i % grid.width) * size;
      const y = Math.floor(i / grid.width) * size;
      c.clearRect(x, y, size, size);
      // AdvanceMap の透明度はマップ側の重み（0.3 なら色 70%・マップ 30%）。スクリーンショットの画素から確かめた。
      c.globalAlpha = 1 - this.opacity;
      c.fillStyle = MOVEMENT_COLORS[value] ?? "#000";
      c.fillRect(x, y, size, size);
      c.globalAlpha = 1;
      c.fillStyle = "#000";
      c.fillText(movementLabel(value), x + size / 2, y + size / 2 + 1);
    }
  }
}
