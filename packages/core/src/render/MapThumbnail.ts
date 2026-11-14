import { BLOCK_ID_MASK } from "../map/constants.js";
import type { BlockRenderer } from "./BlockRenderer.js";
import { createImage, type RgbaImage } from "./color.js";

/** 縮小の大きさ（画素。マップ一覧のサムネイル。#315）。 */
export const THUMBNAIL_SIZE = 48;

/**
 * ブロックごとの平均の色（RGB を 3 バイトずつ）。3 層のブロックも描いた絵（BlockRenderer）から取る。
 * 縮小は 1 ブロックを 1 色として作るので、ブロックの絵を全部は持たない。
 */
export function blockAverageColors(renderer: Pick<BlockRenderer, "render">, count: number): Uint8Array {
  const out = new Uint8Array(count * 3);
  for (let b = 0; b < count; b++) {
    const px = renderer.render(b);
    let r = 0;
    let g = 0;
    let bl = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i]!;
      g += px[i + 1]!;
      bl += px[i + 2]!;
    }
    out[b * 3] = Math.round(r / n);
    out[b * 3 + 1] = Math.round(g / n);
    out[b * 3 + 2] = Math.round(bl / n);
  }
  return out;
}

/**
 * マップの縮小（`size`×`size` の RGBA。縦横比を保って中央に置き、余りは透明）。1 ブロックを 1 色にし、
 * 縮小の 1 画素に入るブロックの色を平均する（マップが小さければ 1 ブロックを数画素に広げる）。
 * `colors` は `blockAverageColors` の結果（番号が範囲外のブロックは黒）。
 */
export function renderThumbnail(grid: { readonly width: number; readonly height: number; readonly cells: Uint16Array }, colors: Uint8Array, size = THUMBNAIL_SIZE): RgbaImage {
  const image = createImage(size, size);
  const { width, height, cells } = grid;
  if (width <= 0 || height <= 0) return image;
  const scale = size / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);
  const count = colors.length / 3;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let by = y0; by < y1; by++) {
        for (let bx = x0; bx < x1; bx++) {
          const block = cells[by * width + bx]! & BLOCK_ID_MASK;
          if (block < count) {
            r += colors[block * 3]!;
            g += colors[block * 3 + 1]!;
            b += colors[block * 3 + 2]!;
          }
          n++;
        }
      }
      const o = ((oy + y) * size + ox + x) * 4;
      image.data[o] = Math.round(r / n);
      image.data[o + 1] = Math.round(g / n);
      image.data[o + 2] = Math.round(b / n);
      image.data[o + 3] = 255;
    }
  }
  return image;
}
