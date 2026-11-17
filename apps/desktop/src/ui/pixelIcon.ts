/**
 * ドット絵のアイコンを SVG の文字列にする（#541）。DOM を使わない。
 *
 * 作りは「オブジェクトの表示」の主人公の PNG（scripts/make-hero-icon.py）と同じ:
 * 1 ドットを 2×2 の画素にして 32×32 に置き、右下へ 1 画素ずらしてぼかした影（黒、濃さ 110/255、ぼかし 0.8）を付ける。
 */

/** アイコンの大きさ（画素）。 */
export const ICON_PIXELS = 32;
/** 1 ドットの大きさ（画素）。 */
export const DOT_SCALE = 2;
/** 影の濃さ（主人公の PNG と同じ 110/255）。 */
const SHADOW_OPACITY = (110 / 255).toFixed(3);

/** ドットの並び（色は CSS の色。透明なら null）。 */
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

/** 横に続く同じ色のドットを 1 つの矩形にまとめる。 */
function runs(grid: PixelGrid, color: (x: number, y: number) => string | null): string {
  let out = "";
  for (let y = 0; y < grid.height; y++) {
    let x = 0;
    while (x < grid.width) {
      const c = color(x, y);
      let end = x + 1;
      while (end < grid.width && color(end, y) === c) end++;
      if (c !== null) {
        out += `<rect x="${x * DOT_SCALE}" y="${y * DOT_SCALE}" width="${(end - x) * DOT_SCALE}" height="${DOT_SCALE}" fill="${c}"/>`;
      }
      x = end;
    }
  }
  return out;
}

/**
 * ドットの並びを 32×32 の SVG にする。`id` は影のフィルターの名前に使う（画面の中で重ならない名前を渡す）。
 * 絵は影の分（1 画素）を残して真ん中に置く。
 */
export function pixelIconSvg(grid: PixelGrid, id: string): string {
  const left = Math.floor((ICON_PIXELS - grid.width * DOT_SCALE - 1) / 2);
  const top = Math.floor((ICON_PIXELS - grid.height * DOT_SCALE - 1) / 2);
  const filter = `px-shadow-${id}`;
  const shadow = runs(grid, (x, y) => (grid.at(x, y) === null ? null : "#000"));
  const body = runs(grid, (x, y) => grid.at(x, y));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_PIXELS}" height="${ICON_PIXELS}" viewBox="0 0 ${ICON_PIXELS} ${ICON_PIXELS}" class="pixel-icon">` +
    `<defs><filter id="${filter}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.8"/></filter></defs>` +
    `<g transform="translate(${left + 1} ${top + 1})" opacity="${SHADOW_OPACITY}" filter="url(#${filter})" shape-rendering="crispEdges">${shadow}</g>` +
    `<g transform="translate(${left} ${top})" shape-rendering="crispEdges">${body}</g>` +
    `</svg>`
  );
}
