import { BLOCK_ID_MASK, BLOCK_PIXELS, createImage, type BlockGrid } from "@zigzagumap/core";
import type { TilesetView } from "../../app/TilesetView";
import { attachCellPointer } from "../../input/CellPointer";
import type { Cell } from "./MapView";

/** 境界ブロックの欄が使う窓口。 */
export interface BorderHost {
  /** 左クリック: 選択中のブロックをその位置（左上）に置く。 */
  place(cell: Cell): void;
  /** 右クリック: その境界ブロックを拾う。 */
  pick(block: number): void;
}

/** 境界ブロック（既定 2×2）の表示と編集。 */
export class BorderView {
  readonly element: HTMLCanvasElement;
  private border: BlockGrid | null = null;
  private tiles: TilesetView | null = null;

  constructor(host: BorderHost) {
    this.element = document.createElement("canvas");
    this.element.className = "border-canvas";
    this.element.addEventListener("contextmenu", (e) => e.preventDefault());
    attachCellPointer(this.element, (e) => this.cellAt(e), {
      down: (cell, g) => {
        if (g.button === 0) host.place(cell);
      },
      up: (cell, g) => {
        if (g.button === 2 && cell && this.border) host.pick(this.border.getBlock(cell.x, cell.y));
      },
    });
  }

  /** 表示する境界ブロックを変える。 */
  set(border: BlockGrid | null, tiles: TilesetView | null): void {
    this.border = border;
    this.tiles = tiles;
    this.redraw();
  }

  /** 描き直す。 */
  redraw(): void {
    const border = this.border;
    const tiles = this.tiles;
    if (!border || !tiles) {
      this.element.width = 0;
      this.element.height = 0;
      return;
    }
    const image = createImage(border.width * BLOCK_PIXELS, border.height * BLOCK_PIXELS);
    for (let y = 0; y < border.height; y++) {
      for (let x = 0; x < border.width; x++) {
        tiles.renderer.blit(border.getCell(x, y) & BLOCK_ID_MASK, image.data, image.width, x * BLOCK_PIXELS, y * BLOCK_PIXELS);
      }
    }
    this.element.width = image.width;
    this.element.height = image.height;
    this.element.getContext("2d")!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }

  private cellAt(e: MouseEvent): Cell | null {
    if (!this.border) return null;
    const r = this.element.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.border.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * this.border.height);
    if (x < 0 || y < 0 || x >= this.border.width || y >= this.border.height) return null;
    return { x, y };
  }
}
