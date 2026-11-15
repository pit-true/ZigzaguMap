import { TOTAL_TILE_COUNT, sheetSelection, type TileSelection } from "@zigzagumap/core";
import { autoId, place } from "../../ui/form/controls";
import type { TilesetModel } from "../TilesetModel";
import { pixelCanvas, pointIn, putRgba } from "./pixelCanvas";

/** 1 行のタイル数。 */
const COLUMNS = 16;
const ROWS = TOTAL_TILE_COUNT / COLUMNS;
/** 表示の倍率（1 タイル 16px）。 */
const SCALE = 2;
const WIDTH = COLUMNS * 8;
const HEIGHT = ROWS * 8;
const CELL = 8 * SCALE;

/** タイル一覧が使う窓口。 */
export interface TileSheetHost {
  /** タイルの矩形を選んだ（ドラッグの途中でも呼ぶ。1 枚なら 1 × 1）。 */
  select(selection: TileSelection): void;
  /** タイルの上にマウスが来た（外れたら null）。 */
  hover(tile: number | null): void;
}

/**
 * タイル一覧（AdvanceMap の TilesetBox。16 列 × 64 行 = 1024 タイル、1 タイル 16px。主 0x000〜、副 0x280〜）。
 * 選んでいるパレットの色で描く（一時適用した色を含む）。
 * 左・右クリックで 1 枚、ドラッグで押した位置と今の位置を角にした矩形を選ぶ（#393）。
 * 2 枚以上を選んでいるときだけ、絵の上に重ねた枠で範囲を示す（絵そのものは AdvanceMap と同じ）。
 */
export class TileSheetView {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** 選んだ矩形の枠（2 枚以上のときだけ出す）。 */
  readonly frame: HTMLElement;
  private anchor: { x: number; y: number } | null = null;

  constructor(private readonly host: TileSheetHost) {
    this.element = place(document.createElement("div"), 8, 88, 273, 137);
    this.element.className += " be-scroll be-tile-sheet";
    this.canvas = pixelCanvas("be.tiles", WIDTH, HEIGHT, SCALE);
    this.frame = autoId(document.createElement("div"), "be.tilesFrame");
    this.frame.className = "be-select-frame";
    this.frame.hidden = true;
    this.element.append(this.canvas, this.frame);
    const cellOf = (e: PointerEvent): { x: number; y: number } | null => {
      const p = pointIn(this.canvas, e);
      const x = Math.floor(p.x / CELL);
      const y = Math.floor(p.y / CELL);
      return x >= 0 && x < COLUMNS && y >= 0 && y < ROWS ? { x, y } : null;
    };
    const update = (e: PointerEvent): void => {
      const c = cellOf(e);
      if (!this.anchor || !c) return;
      const selection = sheetSelection(this.anchor, c, COLUMNS, ROWS);
      this.showFrame(this.anchor, c);
      this.host.select(selection);
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const c = cellOf(e);
      if (!c) return;
      this.anchor = c;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // 自動操作でまねたイベントはつかめない。
      }
      update(e);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      const c = cellOf(e);
      this.host.hover(c ? c.y * COLUMNS + c.x : null);
      if (this.anchor) update(e);
    });
    this.canvas.addEventListener("pointerleave", () => this.host.hover(null));
    this.canvas.addEventListener("pointerup", (e) => {
      if (!this.anchor) return;
      update(e);
      this.anchor = null;
    });
  }

  /** 枠を消す（8 マスから拾ったときなど、一覧の選択でなくなったとき）。 */
  clearFrame(): void {
    this.frame.hidden = true;
  }

  private showFrame(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x) + 1;
    const h = Math.abs(a.y - b.y) + 1;
    this.frame.hidden = w * h <= 1;
    this.frame.style.left = `${x0 * CELL}px`;
    this.frame.style.top = `${y0 * CELL}px`;
    this.frame.style.width = `${w * CELL}px`;
    this.frame.style.height = `${h * CELL}px`;
  }

  /** 描き直す。 */
  render(model: TilesetModel, palette: number): void {
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let tile = 0; tile < TOTAL_TILE_COUNT; tile++) {
      model.drawTile(data, WIDTH, tile, palette, false, false, (tile % COLUMNS) * 8, Math.floor(tile / COLUMNS) * 8);
    }
    putRgba(this.canvas, data);
  }
}
