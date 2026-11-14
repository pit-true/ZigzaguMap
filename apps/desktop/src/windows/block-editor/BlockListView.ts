import { BLOCK_PIXELS } from "@zigzagumap/core";
import { place } from "../../ui/form/controls";
import { shadeTripleChild } from "../../ui/tripleLayerShade";
import type { TilesetModel } from "../TilesetModel";
import { pixelCanvas, pointIn, putRgba, resizePixelCanvas } from "./pixelCanvas";

/** 1 行のブロック数。 */
const COLUMNS = 8;
/** 表示の倍率（1 ブロック 32px）。 */
const SCALE = 2;

/**
 * 左のブロック一覧（AdvanceMap の BlockPaletteBox。8 列、1 ブロック 32px、主の 640 個のあとに副）。
 * 左・右クリックでブロックを選ぶ。AdvanceMap と同じく選択の枠は出さない。
 * 3 層の次の番号（3 層のブロックの 3 枚目に使われている番号）は薄くして斜線を引く（押すと 1 つ前の 3 層のブロックを選ぶ）。
 */
export class BlockListView {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private blocks = 0;

  constructor(private readonly onSelect: (block: number) => void) {
    this.element = place(document.createElement("div"), 0, 0, 273, 233);
    this.element.className += " be-scroll be-block-list";
    this.canvas = pixelCanvas("be.blocks", COLUMNS * BLOCK_PIXELS, 0, SCALE);
    this.element.append(this.canvas);
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const p = pointIn(this.canvas, e);
      const size = BLOCK_PIXELS * SCALE;
      const block = Math.floor(p.y / size) * COLUMNS + Math.floor(p.x / size);
      if (p.x >= 0 && p.x < COLUMNS * size && block >= 0 && block < this.blocks) this.onSelect(block);
    });
  }

  /** 描き直す（データの無い位置は黒）。 */
  render(model: TilesetModel): void {
    this.blocks = model.listedBlocks;
    const rows = Math.ceil(this.blocks / COLUMNS);
    const width = COLUMNS * BLOCK_PIXELS;
    if (this.canvas.height !== rows * BLOCK_PIXELS) resizePixelCanvas(this.canvas, width, rows * BLOCK_PIXELS, SCALE);
    const data = new Uint8ClampedArray(width * rows * BLOCK_PIXELS * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const renderer = model.renderer;
    if (renderer) {
      for (let block = 0; block < this.blocks; block++) {
        if (!model.owner(block)) continue;
        const x = (block % COLUMNS) * BLOCK_PIXELS;
        const y = Math.floor(block / COLUMNS) * BLOCK_PIXELS;
        renderer.blit(block, data, width, x, y);
        if (model.triple?.isTripleChild(block)) shadeTripleChild(data, width, x, y);
      }
    }
    if (rows > 0) putRgba(this.canvas, data);
  }
}
