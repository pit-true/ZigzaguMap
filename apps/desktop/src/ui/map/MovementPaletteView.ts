import { MOVEMENT_MAX } from "@zigzagumap/core";
import { MOVEMENT_COLORS, movementLabel } from "../../app/data/movementColors";
import { attachCellPointer } from "../../input/CellPointer";

/** 移動許可のパレットが使う窓口。 */
export interface MovementPaletteHost {
  select(value: number): void;
  hover(value: number | null): void;
}

/** 1 マスの大きさ（等倍）。 */
const CELL = 16;

/** 右の移動許可のパレット（00〜3F を 1 列に並べ、色と値を描く。選択中は枠で示す）。 */
export class MovementPaletteView {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private zoom = 1;
  private selected = 0;

  constructor(host: MovementPaletteHost) {
    this.element = document.createElement("div");
    this.element.className = "movement-palette";
    this.canvas = document.createElement("canvas");
    this.element.append(this.canvas);
    this.element.addEventListener("contextmenu", (e) => e.preventDefault());
    attachCellPointer(this.canvas, (e) => this.cellAt(e), {
      down: (cell) => host.select(cell.y),
      hover: (cell) => host.hover(cell ? cell.y : null),
    });
    this.redraw();
  }

  /** 拡大を設定する。 */
  configure(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.redraw();
  }

  /** 選択中の値を示す。 */
  showSelection(value: number, scroll: boolean): void {
    this.selected = value;
    this.redraw();
    if (scroll) {
      const size = CELL * this.zoom;
      const top = value * size;
      if (top < this.element.scrollTop || top + size > this.element.scrollTop + this.element.clientHeight) {
        this.element.scrollTop = top - this.element.clientHeight / 2;
      }
    }
  }

  private redraw(): void {
    const size = CELL * this.zoom;
    const count = MOVEMENT_MAX + 1;
    this.canvas.width = size;
    this.canvas.height = size * count;
    const c = this.canvas.getContext("2d")!;
    c.font = `${10 * this.zoom}px "MS UI Gothic", sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let v = 0; v < count; v++) {
      c.fillStyle = MOVEMENT_COLORS[v] ?? "#000";
      c.fillRect(0, v * size, size, size);
      c.fillStyle = "#000";
      c.fillText(movementLabel(v), size / 2, v * size + size / 2 + 1);
    }
    c.strokeStyle = "#000";
    c.lineWidth = 2;
    c.strokeRect(1, this.selected * size + 1, size - 2, size - 2);
    c.strokeStyle = "#fff";
    c.lineWidth = 1;
    c.strokeRect(2.5, this.selected * size + 2.5, size - 5, size - 5);
  }

  private cellAt(e: MouseEvent): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const y = Math.floor((e.clientY - r.top) / (CELL * this.zoom));
    return y >= 0 && y <= MOVEMENT_MAX && e.clientX >= r.left && e.clientX < r.right ? { x: 0, y } : null;
  }
}
