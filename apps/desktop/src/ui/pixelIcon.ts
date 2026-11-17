/**
 * ドット絵のアイコンを 32×32 の画素にする（#541）。DOM を使わない（画面に出すときは icons.ts が PNG にする）。
 *
 * 作りは「オブジェクトの表示」の主人公の PNG（scripts/make-hero-icon.py）と同じ:
 * 1 ドットを 2×2 の画素にして 32×32 に置き、右下へ 1 画素ずらしてぼかした影（黒、濃さ 110/255、ぼかし 0.8）を付ける。
 */

/** アイコンの大きさ（画素）。 */
export const ICON_PIXELS = 32;
/** 1 ドットの大きさ（画素）。 */
export const DOT_SCALE = 2;
/** 影の濃さ（主人公の PNG と同じ 110/255）。 */
const SHADOW_ALPHA = 110;

/** ドットの並び（色は #rrggbb。透明なら null）。 */
export interface PixelGrid {
  readonly width: number;
  readonly height: number;
  at(x: number, y: number): string | null;
}

/** 行の文字列と色の表からドットの並びを作る（表に無い文字は透明。ふつうは `.`）。 */
export function gridFromRows(rows: readonly string[], colors: Readonly<Record<string, string>>): PixelGrid {
  return {
    width: Math.max(0, ...rows.map((r) => r.length)),
    height: rows.length,
    at: (x, y) => colors[rows[y]?.[x] ?? ""] ?? null,
  };
}

/** RGBA の画素からドットの並びを作る（透明度 0 は透明）。 */
export function gridFromRgba(image: { readonly width: number; readonly height: number; readonly data: ArrayLike<number> }): PixelGrid {
  const hex = (v: number): string => v.toString(16).padStart(2, "0");
  return {
    width: image.width,
    height: image.height,
    at: (x, y) => {
      const o = (y * image.width + x) * 4;
      if (x < 0 || y < 0 || x >= image.width || y >= image.height || image.data[o + 3] === 0) return null;
      return `#${hex(image.data[o]!)}${hex(image.data[o + 1]!)}${hex(image.data[o + 2]!)}`;
    },
  };
}

/** `under` の上に `over` を `left`・`top` だけずらして重ねる（`over` の透明な所は下が見える）。 */
export function overlayGrid(under: PixelGrid, over: PixelGrid, left: number, top: number): PixelGrid {
  return {
    width: under.width,
    height: under.height,
    at: (x, y) => over.at(x - left, y - top) ?? under.at(x, y),
  };
}

/** ぼかしの重み（ガウス、σ = 0.8、半径 3 画素。主人公の PNG の影と同じぼかし）。 */
const BLUR = ((): number[] => {
  const w = [-3, -2, -1, 0, 1, 2, 3].map((d) => Math.exp(-(d * d) / (2 * 0.8 * 0.8)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / sum);
})();

/**
 * 影（32×32 の画素ごとの濃さ、0〜255）。絵のある画素を右下へ 1 画素ずらして濃さ 110 にし、縦横にぼかす。
 */
function shadowAlpha(grid: PixelGrid, left: number, top: number): Uint8Array {
  const n = ICON_PIXELS;
  const mask = new Float32Array(n * n);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.at(x, y) === null) continue;
      for (let dy = 0; dy < DOT_SCALE; dy++) {
        for (let dx = 0; dx < DOT_SCALE; dx++) {
          const px = left + 1 + x * DOT_SCALE + dx;
          const py = top + 1 + y * DOT_SCALE + dy;
          if (px < n && py < n) mask[py * n + px] = SHADOW_ALPHA;
        }
      }
    }
  }
  const pass = (src: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0;
        for (let k = -3; k <= 3; k++) {
          const sx = horizontal ? x + k : x;
          const sy = horizontal ? y : y + k;
          if (sx >= 0 && sy >= 0 && sx < n && sy < n) v += src[sy * n + sx]! * BLUR[k + 3]!;
        }
        out[y * n + x] = v;
      }
    }
    return out;
  };
  return Uint8Array.from(pass(pass(mask, true), false), (v) => Math.round(v));
}

/** 32×32 の RGBA の画素。 */
export interface IconPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * ドットの並びを 32×32 の RGBA の画素にする（DOM を使わない）。絵は影の分（1 画素）を残して真ん中に置く。
 * 影（黒、ぼかした濃さ）の上に、絵のドットを 2×2 の画素で不透明に描く。
 */
export function pixelIconPixels(grid: PixelGrid): IconPixels {
  const n = ICON_PIXELS;
  const left = Math.floor((n - grid.width * DOT_SCALE - 1) / 2);
  const top = Math.floor((n - grid.height * DOT_SCALE - 1) / 2);
  const data = new Uint8ClampedArray(n * n * 4);
  const alpha = shadowAlpha(grid, left, top);
  for (let i = 0; i < n * n; i++) data[i * 4 + 3] = alpha[i]!;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const c = grid.at(x, y);
      if (c === null) continue;
      const v = parseInt(c.slice(1), 16);
      for (let dy = 0; dy < DOT_SCALE; dy++) {
        for (let dx = 0; dx < DOT_SCALE; dx++) {
          const o = ((top + y * DOT_SCALE + dy) * n + left + x * DOT_SCALE + dx) * 4;
          data[o] = v >> 16;
          data[o + 1] = (v >> 8) & 255;
          data[o + 2] = v & 255;
          data[o + 3] = 255;
        }
      }
    }
  }
  return { width: n, height: n, data };
}
