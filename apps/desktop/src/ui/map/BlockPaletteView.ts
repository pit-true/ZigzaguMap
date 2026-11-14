import { BLOCK_PIXELS } from "@zigzagumap/core";
import type { BlockSelection } from "../../app/EditorState";
import type { TilesetView } from "../../app/TilesetView";
import { attachCellPointer } from "../../input/CellPointer";
import { paletteBlock, paletteRectSelection } from "../../input/tripleRules";
import { toImageData } from "../canvas";
import { drawGrid, type Cell } from "./MapView";
import { drawPaletteSelection, tripleChildLayer, type PaletteGeometry, type PaletteLayer, type PaletteLayerPass, type PaletteRect } from "./paletteLayers";

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
 * ほかの機能が重ねて描くものは `addLayer` で段（paletteLayers.ts の PaletteLayerPass）を決めて足す（Phase4 #318）。
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
  /** 重ねて描くもの（段ごと。足した順に描く）。 */
  private readonly layers: Record<PaletteLayerPass, PaletteLayer[]> = { blocks: [], grid: [], overlay: [] };
  /** マウスの下のブロックが変わったときに呼ぶもの（ブロックの情報の表示。Phase4 #308。外れたら null）。 */
  readonly hoverListeners: ((block: number | null) => void)[] = [];

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
        for (const l of this.hoverListeners) l(block);
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

  /**
   * 重ねて描くものを足す。`blocks`・`grid` の段は中身が変わったら `refresh`、`overlay` の段は `repaintOverlay` で描き直す。
   */
  addLayer(pass: PaletteLayerPass, layer: PaletteLayer): void {
    this.layers[pass].push(layer);
  }

  /** `overlay` の段に重ねて描くものが変わったときに描き直す。 */
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
      const g = this.geometry(tiles, BLOCK_PIXELS);
      for (const layer of [tripleChildLayer(tiles), ...this.layers.blocks]) layer(ctx, g);
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
    // 等倍でグリッドを出さないときは、グリッドの Canvas に領域を持たず、描き足すもの（境目の線）はブロックの絵の上に描く
    // （パレットと同じ大きさの Canvas を 1 枚減らす。Phase4 #318。ブロックの絵は等倍なので、拡大表示のときは今までどおり）
    const onBase = !this.grid && this.zoom === 1;
    this.gridCanvas.width = onBase ? 0 : dw;
    this.gridCanvas.height = onBase ? 0 : dh;
    if (this.grid && dw > 0) drawGrid(this.gridCanvas, size);
    if (tiles && dw > 0) {
      const target = (onBase ? this.base : this.gridCanvas).getContext("2d")!;
      const g = this.geometry(tiles, size);
      for (const layer of this.layers.grid) layer(target, g);
    }
    this.drawSelection(null);
  }

  private geometry(tiles: TilesetView, size: number): PaletteGeometry {
    const width = this.width;
    return { size, width, count: tiles.paletteBlockCount, cellOf: (b) => tiles.positionOf(b, width) };
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

  private selectRect(r: PaletteRect): void {
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

  /** 重ねて描くもの（`overlay` の段）と選択の枠を描く。`dragging` を渡すとドラッグ中の矩形を描く。 */
  private drawSelection(dragging: PaletteRect | null): void {
    const c = this.overlay.getContext("2d")!;
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const tiles = this.tiles;
    if (!tiles) return;
    const g = this.geometry(tiles, BLOCK_PIXELS * this.zoom);
    for (const layer of this.layers.overlay) layer(c, g);
    drawPaletteSelection(c, tiles, g, this.selection, dragging);
  }
}

function rectOf(a: Cell, b: Cell): PaletteRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
