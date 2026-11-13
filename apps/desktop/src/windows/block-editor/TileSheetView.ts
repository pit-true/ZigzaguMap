import { TOTAL_TILE_COUNT } from "@zigzagumap/core";
import { place } from "../../ui/form/controls";
import type { TilesetModel } from "../TilesetModel";
import { pixelCanvas, pointIn, putRgba } from "./pixelCanvas";

/** 1 行のタイル数。 */
const COLUMNS = 16;
/** 表示の倍率（1 タイル 16px）。 */
const SCALE = 2;
const WIDTH = COLUMNS * 8;
const HEIGHT = (TOTAL_TILE_COUNT / COLUMNS) * 8;

/**
 * タイル一覧（AdvanceMap の TilesetBox。16 列 × 64 行 = 1024 タイル、1 タイル 16px。主 0x000〜、副 0x280〜）。
 * 選んでいるパレットの色で描く（一時適用した色を含む）。左・右クリックとドラッグで、最後に離した位置のタイルを選ぶ。
 */
export class TileSheetView {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private pressed = false;

  constructor(private readonly onSelect: (tile: number) => void) {
    this.element = place(document.createElement("div"), 8, 88, 273, 137);
    this.element.className += " be-scroll be-tile-sheet";
    this.canvas = pixelCanvas("be.tiles", WIDTH, HEIGHT, SCALE);
    this.element.append(this.canvas);
    const pick = (e: PointerEvent): void => {
      const p = pointIn(this.canvas, e);
      const size = 8 * SCALE;
      const col = Math.floor(p.x / size);
      const row = Math.floor(p.y / size);
      if (col >= 0 && col < COLUMNS && row >= 0 && row < HEIGHT / 8) this.onSelect(row * COLUMNS + col);
    };
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.pressed = true;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // 自動操作でまねたイベントはつかめない。
      }
      pick(e);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (this.pressed) pick(e);
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (!this.pressed) return;
      this.pressed = false;
      pick(e);
    });
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
