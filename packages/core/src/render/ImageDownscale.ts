import { createImage, type RgbaImage } from "./color.js";

/** 縮小の大きさ（長い辺を `maxSide` 画素以下に。縦横比を保つ。元が小さければ等倍）。 */
export function downscaleSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * RGBA の画像を縮める（ミニマップ。Phase7 #511）。長い辺を `maxSide` 画素以下にし、縮めた 1 画素に入る元の画素の色を平均する。
 * 元の画像は書き換えない。縮めた画像だけを新しく作る（元と同じ大きさの画像は作らない）。
 */
export function downscaleImage(src: RgbaImage, maxSide: number): RgbaImage {
  const { width: w, height: h } = downscaleSize(src.width, src.height, maxSide);
  const out = createImage(w, h);
  const sw = src.width;
  const sh = src.height;
  const data = src.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * sh) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * sw) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * sw + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) {
          r += data[i]!;
          g += data[i + 1]!;
          b += data[i + 2]!;
          a += data[i + 3]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}
