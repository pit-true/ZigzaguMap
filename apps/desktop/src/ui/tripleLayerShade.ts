import { BLOCK_PIXELS } from "@zigzagumap/core";

/** 3 層の次の番号を薄くする割合（0〜1。背景の灰色へ寄せる）。 */
const FADE = 0.55;
/** 薄くするときに寄せる色（灰色）。 */
const FADE_TO = 160;
/** 斜線の間隔（画素）。 */
const HATCH_STEP = 4;

/**
 * 3 層のブロックの 3 枚目に使われている番号（3 層の次の番号）の見せ方（#319 の Q4 の推奨: 絵を薄くして斜線を引く）。
 * RGBA の画像（幅 `width`）の (x, y) から 16×16 を描き換える。ブロックパレットとブロックエディタの一覧で同じ見せ方にする。
 */
export function shadeTripleChild(data: Uint8ClampedArray, width: number, x: number, y: number): void {
  for (let py = 0; py < BLOCK_PIXELS; py++) {
    for (let px = 0; px < BLOCK_PIXELS; px++) {
      const o = ((y + py) * width + x + px) * 4;
      if ((px + py) % HATCH_STEP === 0) {
        data[o] = 64;
        data[o + 1] = 64;
        data[o + 2] = 64;
      } else {
        for (let c = 0; c < 3; c++) data[o + c] = Math.round(data[o + c]! * (1 - FADE) + FADE_TO * FADE);
      }
      data[o + 3] = 255;
    }
  }
}
