import { BLOCK_PIXELS } from "@zigzagumap/core";
import type { BlockSelection } from "../../app/EditorState";
import type { TilesetView } from "../../app/TilesetView";
import { attachCellPointer } from "../../input/CellPointer";
import { paletteBlock, paletteRectSelection } from "../../input/tripleRules";
import { toImageData } from "../canvas";
import { drawGrid, type Cell } from "./MapView";

/** ブロックパレットが使う窓口。 */
export interface BlockPaletteHost {
  /** ブロックを選んだ（1 つか、Ctrl＋右ドラッグの矩形。矩形なら `stamp` が true）。 */
  select(selection: BlockSelection, stamp: boolean): void;
  /** マウスの下のブロック（無ければ null）。 */
  hover(block: number | null, offset: number | null): void;
  /** Ctrl＋左クリック: ミキシングバッグにブロックを出し入れする（#236。無ければ普通の左クリックと同じ）。 */
  toggleBag?(block: number): void;
}

/**
 * 右のブロックパレット（主の 640 個の後に副を並べる、1 行 8 個が既定）。
 * 左・右クリックで 1 つ選び、Ctrl＋右ドラッグで矩形を選ぶ。選択中は赤い枠で囲む。
 * Ctrl＋左クリックはミキシングバッグへの出し入れ（#236。窓口が受けるとき）。
 * 3 層のブロック（#300）: 3 枚目に使われている次の番号は絵を薄くして斜線を引き、押すと 1 つ前の 3 層のブロックを選ぶ。
 * 3 層のブロックを選んでいる間は、選択の枠を次の番号まで 2 マス分にする（Bochi と同じ）。
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
  /**
   * 選択の枠の下に重ねて描くもの（自動ペンで描けるブロックの色。Phase4 #310。別のファイルの部品が入れる）。
   * `cellOf` はブロックのパレット上の (列, 行)。
   */
  decorate: ((c: CanvasRenderingContext2D, size: number, blocks: number, cellOf: (block: number) => { col: number; row: number }) => void) | null = null;

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
        } else if (g.button === 0 && g.ctrl && this.host.toggleBag) {
          const block = this.tiles?.blockAt(cell.x, cell.y, this.width);
          if (block !== null && block !== undefined) this.host.toggleBag(paletteBlock(this.tiles!.triple, block));
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

  /** 同じ組のまま、ブロックの絵や数が変わったときに描き直す。 */
  refresh(): void {
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

  /** 重ねて描くもの（`decorate`）が変わったときに描き直す。 */
  repaintOverlay(): void {
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
      const ctx = this.base.getContext("2d")!;
      ctx.putImageData(toImageData(image), 0, 0);
      this.markTripleChildren(ctx);
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

  /** 3 層の次の番号（単独では置けないブロック）の絵を薄くして斜線を引く（Q4 の推奨）。 */
  private markTripleChildren(ctx: CanvasRenderingContext2D): void {
    const tiles = this.tiles;
    if (!tiles) return;
    const total = tiles.paletteBlockCount;
    ctx.save();
    for (let i = 0; i < total; i++) {
      const block = i;
      if (!tiles.triple.isTripleChild(block)) continue;
      const p = tiles.positionOf(block, this.width);
      const x = p.col * BLOCK_PIXELS;
      const y = p.row * BLOCK_PIXELS;
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.fillRect(x, y, BLOCK_PIXELS, BLOCK_PIXELS);
      ctx.strokeStyle = "rgba(200, 0, 0, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y + BLOCK_PIXELS - 0.5);
      ctx.lineTo(x + BLOCK_PIXELS - 0.5, y + 0.5);
      ctx.moveTo(x + 0.5, y + BLOCK_PIXELS / 2);
      ctx.lineTo(x + BLOCK_PIXELS / 2, y + 0.5);
      ctx.moveTo(x + BLOCK_PIXELS / 2, y + BLOCK_PIXELS - 0.5);
      ctx.lineTo(x + BLOCK_PIXELS - 0.5, y + BLOCK_PIXELS / 2);
      ctx.stroke();
    }
    ctx.restore();
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
    this.host.select({ width: 1, height: 1, blocks: [paletteBlock(this.tiles!.triple, block)] }, false);
  }

  private selectRect(r: { x: number; y: number; w: number; h: number }): void {
    const tiles = this.tiles;
    if (!tiles) return;
    if (r.w === 1 && r.h === 1) {
      // 1 マスだけの矩形は、ふつうに押したのと同じ（3 層の次の番号なら 3 層のブロック）
      const b = tiles.blockAt(r.x, r.y, this.width);
      if (b !== null) this.host.select({ width: 1, height: 1, blocks: [paletteBlock(tiles.triple, b)] }, true);
      return;
    }
    this.host.select(paletteRectSelection(r, (x, y) => tiles.blockAt(x, y, this.width), tiles.triple, this.width), true);
  }

  /** 選択の枠を描く。`dragging` を渡すとドラッグ中の矩形を描く。 */
  private drawSelection(dragging: { x: number; y: number; w: number; h: number } | null): void {
    const c = this.overlay.getContext("2d")!;
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.tiles) return;
    const size = BLOCK_PIXELS * this.zoom;
    if (this.decorate) {
      const tiles = this.tiles;
      this.decorate(c, size, tiles.paletteBlockCount, (b) => tiles.positionOf(b, this.width));
    }
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
    const single = !dragging && this.selection && this.selection.width === 1 && this.selection.height === 1;
    const third = single ? this.tiles.triple.thirdOf(this.selection!.blocks[0] ?? 0) : null;
    if (third !== null) {
      // 3 層のブロック: 次の番号まで 2 マス分の枠（行の端で折り返すときは 2 つの枠）
      const q = this.tiles.positionOf(third, this.width);
      if (q.row === r.y && q.col === r.x + 1) {
        c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, 2 * size - 1, size - 1);
      } else {
        c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, size - 1, size - 1);
        c.strokeRect(q.col * size + 0.5, q.row * size + 0.5, size - 1, size - 1);
      }
      return;
    }
    c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, r.w * size - 1, r.h * size - 1);
  }
}

function rectOf(a: Cell, b: Cell): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
