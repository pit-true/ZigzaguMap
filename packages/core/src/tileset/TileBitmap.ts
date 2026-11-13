import { DataError } from "../binary/DataError.js";
import { TILE_BYTES } from "../map/constants.js";
import { decodeIndexedPng, type IndexedImage } from "../project/png/PngDecoder.js";
import type { InflateFunction } from "../project/png/inflate.js";
import { pixelsToTiles } from "../project/TilesetSource.js";
import { bgr555ToRgb } from "./blockFormat.js";
import { tilesToPixels } from "./TileImage.js";

/** タイル 1 枚の一辺のピクセル数。 */
const TILE_PIXELS = 8;
/** BMP のファイルヘッダーの大きさ。 */
const BMP_FILE_HEADER = 14;
/** BMP の情報ヘッダー（BITMAPINFOHEADER）の大きさ。 */
const BMP_INFO_HEADER = 40;

/**
 * タイルを 24 ビットの DIB（BMP と同じ形式、横 128 ピクセル）にする。
 * AdvanceMap の「マップチップ > タイルセット１の保存」と同じく、`tileCount` 枚（足りない分は色 0）を
 * 16 色のパレット `colors`（BGR555）の色（5 ビットを 8 倍）で描く。
 */
export function encodeTilesDib(tiles: Uint8Array, colors: ArrayLike<number>, tileCount: number): Uint8Array {
  const image = tilesToPixels(tiles, tileCount);
  const rgb = Array.from({ length: 16 }, (_, i) => bgr555ToRgb(colors[i] ?? 0));
  const { width, height, pixels } = image;
  const stride = (width * 3 + 3) & ~3;
  const size = BMP_FILE_HEADER + BMP_INFO_HEADER + stride * height;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, BMP_FILE_HEADER + BMP_INFO_HEADER, true);
  v.setUint32(14, BMP_INFO_HEADER, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, stride * height, true);
  for (let y = 0; y < height; y++) {
    const row = BMP_FILE_HEADER + BMP_INFO_HEADER + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb[pixels[y * width + x]! & 0xf]!;
      out[row + x * 3] = b;
      out[row + x * 3 + 1] = g;
      out[row + x * 3 + 2] = r;
    }
  }
  return out;
}

/** タイル画像を読んだ結果。 */
export interface DecodedTiles {
  /** 4bpp タイル（左上から横へ数えた順）。 */
  readonly tiles: Uint8Array;
  /** タイル数。 */
  readonly tileCount: number;
}

/**
 * タイルセットの画像（BMP・DIB の 1/4/8/24/32 ビット、インデックス PNG）を 4bpp タイルにする。
 * - インデックス画像: 色番号がすべて 15 以下ならそのまま使う。16 以上があれば、画像のパレットの色を `colors` の近い色に置き換える。
 * - 24/32 ビット: 各ピクセルを `colors`（BGR555 の 16 色）の同じ色（5 ビットにそろえて比べる）に、無ければ一番近い色にする。
 * 幅・高さが 8 の倍数でない画像、読めない形式は DataError。
 */
export function decodeTileImage(bytes: Uint8Array, colors: ArrayLike<number>, inflate?: InflateFunction): DecodedTiles {
  let width: number;
  let height: number;
  let pixels: Uint8Array;
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    ({ width, height, pixels } = decodeBmp(bytes, colors));
  } else if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const image = decodeIndexedPng(bytes, inflate);
    ({ width, height } = image);
    pixels = toPaletteIndices(image, colors);
  } else {
    throw new DataError("BMP（DIB）でも PNG でもありません");
  }
  if (width % TILE_PIXELS !== 0 || height % TILE_PIXELS !== 0 || width === 0 || height === 0) {
    throw new DataError("画像の大きさが 8 の倍数ではありません");
  }
  const tiles = pixelsToTiles(pixels, width, height);
  return { tiles, tileCount: tiles.length / TILE_BYTES };
}

/** 色番号の画像を 0〜15 にそろえる（16 以上があれば画像のパレットの色から近い色を選ぶ）。 */
function toPaletteIndices(image: IndexedImage, colors: ArrayLike<number>): Uint8Array {
  if (!image.pixels.some((p) => p > 15)) return image.pixels;
  const matcher = colorMatcher(colors);
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const at = i * 3;
    map[i] = at + 2 < image.palette.length ? matcher(image.palette[at]!, image.palette[at + 1]!, image.palette[at + 2]!) : 0;
  }
  return image.pixels.map((p) => map[p]!);
}

/** RGB（8 ビット）を 16 色のうち同じか一番近い色の番号にする関数。 */
function colorMatcher(colors: ArrayLike<number>): (r: number, g: number, b: number) => number {
  const rgb = Array.from({ length: 16 }, (_, i) => bgr555ToRgb(colors[i] ?? 0).map((c) => c >> 3));
  const cache = new Map<number, number>();
  return (r, g, b) => {
    const r5 = r >> 3;
    const g5 = g >> 3;
    const b5 = b >> 3;
    const key = r5 | (g5 << 5) | (b5 << 10);
    let best = cache.get(key);
    if (best !== undefined) return best;
    let bestDistance = Infinity;
    best = 0;
    for (let i = 0; i < 16; i++) {
      const c = rgb[i]!;
      const d = (c[0]! - r5) ** 2 + (c[1]! - g5) ** 2 + (c[2]! - b5) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };
}

/** 無圧縮の BMP を色番号の画像にする。 */
function decodeBmp(bytes: Uint8Array, colors: ArrayLike<number>): { width: number; height: number; pixels: Uint8Array } {
  if (bytes.length < BMP_FILE_HEADER + BMP_INFO_HEADER) throw new DataError("BMP が短すぎます");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataAt = v.getUint32(10, true);
  const infoSize = v.getUint32(14, true);
  const width = v.getInt32(18, true);
  const rawHeight = v.getInt32(22, true);
  const bits = v.getUint16(28, true);
  const compression = v.getUint32(30, true);
  const used = v.getUint32(46, true);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  if (width <= 0 || height === 0) throw new DataError("BMP の大きさが不正です");
  if (![1, 4, 8, 24, 32].includes(bits)) throw new DataError(`${bits} ビットの BMP は読めません`);
  // 0: BI_RGB、3: BI_BITFIELDS（32 ビットの BGRA として読む）。
  if (compression !== 0 && !(compression === 3 && bits === 32)) throw new DataError("圧縮された BMP は読めません");
  const stride = ((width * bits + 31) >> 5) * 4;
  if (dataAt + stride * height > bytes.length) throw new DataError("BMP の画素データが途中で切れています");
  const pixels = new Uint8Array(width * height);

  if (bits <= 8) {
    const paletteAt = BMP_FILE_HEADER + infoSize;
    const count = used || 1 << bits;
    const raw = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = dataAt + (topDown ? y : height - 1 - y) * stride;
      for (let x = 0; x < width; x++) {
        const bit = x * bits;
        const byte = bytes[row + (bit >> 3)]!;
        raw[y * width + x] = (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
      }
    }
    const palette = new Uint8Array(256 * 3);
    for (let i = 0; i < Math.min(count, 256); i++) {
      const at = paletteAt + i * 4;
      if (at + 3 > bytes.length) break;
      palette[i * 3] = bytes[at + 2]!;
      palette[i * 3 + 1] = bytes[at + 1]!;
      palette[i * 3 + 2] = bytes[at]!;
    }
    return { width, height, pixels: toPaletteIndices({ width, height, pixels: raw, palette }, colors) };
  }

  const matcher = colorMatcher(colors);
  const step = bits / 8;
  for (let y = 0; y < height; y++) {
    const row = dataAt + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const at = row + x * step;
      pixels[y * width + x] = matcher(bytes[at + 2]!, bytes[at + 1]!, bytes[at]!);
    }
  }
  return { width, height, pixels };
}
