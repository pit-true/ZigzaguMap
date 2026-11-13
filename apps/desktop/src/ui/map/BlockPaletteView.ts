import { BLOCK_PIXELS } from "@zigzagumap/core";
import type { BlockSelection } from "../../app/EditorState";
import type { TilesetView } from "../../app/TilesetView";
import { attachCellPointer } from "../../input/CellPointer";
import { drawGrid, type Cell } from "./MapView";

/** ブロックパレットが使う窓口。 */
export interface BlockPaletteHost {
  /** ブロックを選んだ（1 つか、Ctrl＋右ドラッグの矩形）。 */
  select(selection: BlockSelection): void;
  /** マウスの下のブロック（無ければ null）。 */
  hover(block: number | null, offset: number | null): void;
}

/**
 * 右のブロックパレット（主の 640 個の後に副を並べる、1 行 8 個が既定）。
 * 左・右クリックで 1 つ選び、Ctrl＋右ドラッグで矩形を選ぶ。選択中は赤い枠で囲む。
 */
export class BlockPaletteView {
  readonly element: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly base: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly gridCanvas: HTMLCanvasElement;
  private tiles: TilesetView | null = null;
  private width = 8;
  private zoom = 1;
  private grid = false;
  private selection: BlockSelection | null = null;
  /** Ctrl＋右ドラッグの始点。 */
  private anchor: Cell | null = null;

  constructor(private readonly host: BlockPaletteHost) {
    this.element = document.createElement("div");
    this.element.className = "block-palette";
    this.stage = document.createElement("div");
    this.stage.className = "palette-stage";
    this.base = document.createElement("canvas");
    this.overlay = document.createElement("canvas");
    this.gridCanvas = document.createElement("canvas");
    this.stage.append(this.base, this.gridCanvas, this.overlay);
    this.element.append(this.stage);
    this.element.addEventListener("contextmenu", (e) => e.preventDefault());

    attachCellPointer(this.stage, (e) => this.cellAt(e), {
      down: (cell, g) => {
        if (g.button === 2 && g.ctrl) {
          this.anchor = cell;
          this.drawSelection(rectOf(cell, cell));
        } else {
          this.pick(cell);
        }
      },
      move: (cell, g) => {
        if (g.button === 2 && g.ctrl && this.anchor) this.drawSelection(rectOf(this.anchor, cell));
      },
      up: (cell, g) => {
        if (g.button === 2 && g.ctrl && this.anchor) {
          const r = rectOf(this.anchor, cell ?? this.anchor);
          this.anchor = null;
          this.selectRect(r);
        }
      },
      hover: (cell) => {
        const block = cell && this.tiles ? this.tiles.blockAt(cell.x, cell.y, this.width) : null;
        this.host.hover(block, block !== null && this.tiles ? this.tiles.blockOffset(block) : null);
      },
    });
  }

  /** タイルセットの組を変える（null で空）。 */
  setTiles(tiles: TilesetView | null): void {
    if (tiles === this.tiles) return;
    this.tiles = tiles;
    this.redraw();
  }

  /** 1 行の数、拡大、グリッドを設定する。 */
  configure(width: number, zoom: number, grid: boolean): void {
    if (width === this.width && zoom === this.zoom && grid === this.grid) return;
    this.width = width;
    this.zoom = zoom;
    this.grid = grid;
    this.redraw();
  }

  /** 選択中のブロックを示す。 */
  showSelection(selection: BlockSelection): void {
    this.selection = selection;
    this.drawSelection(null);
  }

  /** 選択中のブロックが見えるようにスクロールする。 */
  scrollToSelection(): void {
    if (!this.tiles || !this.selection) return;
    const p = this.tiles.positionOf(this.selection.blocks[0] ?? 0, this.width);
    const size = BLOCK_PIXELS * this.zoom;
    const top = p.row * size;
    if (top < this.element.scrollTop || top + size > this.element.scrollTop + this.element.clientHeight) {
      this.element.scrollTop = top - this.element.clientHeight / 2 + size / 2;
    }
  }

  private redraw(): void {
    const tiles = this.tiles;
    const size = BLOCK_PIXELS * this.zoom;
    const rows = tiles ? tiles.paletteRows(this.width) : 0;
    const w = tiles ? this.width * BLOCK_PIXELS : 0;
    const h = rows * BLOCK_PIXELS;
    this.base.width = w;
    this.base.height = h;
    if (tiles) {
      const image = tiles.paletteImage(this.width);
      this.base.getContext("2d")!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    }
    const dw = w * this.zoom;
    const dh = h * this.zoom;
    for (const c of [this.base, this.overlay, this.gridCanvas]) {
      c.style.width = `${dw}px`;
      c.style.height = `${dh}px`;
    }
    this.stage.style.width = `${dw}px`;
    this.stage.style.height = `${dh}px`;
    this.overlay.width = dw;
    this.overlay.height = dh;
    this.gridCanvas.width = dw;
    this.gridCanvas.height = dh;
    if (this.grid && dw > 0) drawGrid(this.gridCanvas, size);
    this.drawSelection(null);
  }

  private cellAt(e: MouseEvent): Cell | null {
    if (!this.tiles) return null;
    const r = this.base.getBoundingClientRect();
    const size = BLOCK_PIXELS * this.zoom;
    const x = Math.floor((e.clientX - r.left) / size);
    const y = Math.floor((e.clientY - r.top) / size);
    if (x < 0 || y < 0 || x >= this.width || y >= this.tiles.paletteRows(this.width)) return null;
    return { x, y };
  }

  private pick(cell: Cell): void {
    const block = this.tiles?.blockAt(cell.x, cell.y, this.width);
    if (block === null || block === undefined) return;
    this.host.select({ width: 1, height: 1, blocks: [block] });
  }

  private selectRect(r: { x: number; y: number; w: number; h: number }): void {
    if (!this.tiles) return;
    const blocks: number[] = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) blocks.push(this.tiles.blockAt(x, y, this.width) ?? 0);
    }
    this.host.select({ width: r.w, height: r.h, blocks });
  }

  /** 選択の枠を描く。`dragging` を渡すとドラッグ中の矩形を描く。 */
  private drawSelection(dragging: { x: number; y: number; w: number; h: number } | null): void {
    const c = this.overlay.getContext("2d")!;
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.tiles) return;
    const size = BLOCK_PIXELS * this.zoom;
    let r = dragging;
    if (!r && this.selection) {
      const s = this.selection;
      if (s.width === 1 && s.height === 1) {
        const p = this.tiles.positionOf(s.blocks[0] ?? 0, this.width);
        r = { x: p.col, y: p.row, w: 1, h: 1 };
      } else {
        // パレットから選んだ矩形なら、左上のブロックの位置から枠を出す。
        const p = this.tiles.positionOf(s.blocks[0] ?? 0, this.width);
        const fits = s.blocks.every((b, i) => {
          const q = this.tiles!.positionOf(b, this.width);
          return q.col === p.col + (i % s.width) && q.row === p.row + Math.floor(i / s.width);
        });
        if (fits) r = { x: p.col, y: p.row, w: s.width, h: s.height };
      }
    }
    if (!r) return;
    c.strokeStyle = "#ff0000";
    c.lineWidth = 1;
    c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, r.w * size - 1, r.h * size - 1);
  }
}

function rectOf(a: Cell, b: Cell): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
