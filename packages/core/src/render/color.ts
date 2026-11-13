/** BGR555 の色を RGBA（1 色 4 バイト、不透明）へ変換し、`out` の `index` 番目に書く。 */
export function writeBgr555(out: Uint8ClampedArray, index: number, color: number): void {
  const r = color & 0x1f;
  const g = (color >> 5) & 0x1f;
  const b = (color >> 10) & 0x1f;
  const o = index * 4;
  out[o] = (r << 3) | (r >> 2);
  out[o + 1] = (g << 3) | (g >> 2);
  out[o + 2] = (b << 3) | (b >> 2);
  out[o + 3] = 255;
}

/** RGBA の画像。`data` は幅×高さ×4 バイト。Canvas の ImageData にそのまま渡せる。 */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/** 空の RGBA 画像を作る。 */
export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}
