import { TILE_BYTES } from "../map/constants.js";
import { encodeIndexedPng } from "../project/png/PngEncoder.js";
import { decodeIndexedPng, type IndexedImage } from "../project/png/PngDecoder.js";
import type { DeflateFunction } from "../project/png/deflate.js";
import type { InflateFunction } from "../project/png/inflate.js";
import { pixelsToTiles } from "../project/TilesetSource.js";
import { bgr555ToRgb } from "./blockFormat.js";

/** タイル画像の横幅（16 タイル）。 */
export const TILE_IMAGE_WIDTH = 128;
/** 1 行のタイル数。 */
export const TILES_PER_ROW = 16;
/** 1 タイルの一辺のピクセル数。 */
const TILE_PIXELS = 8;

/** 4bpp タイル（左上から横へ並べた順）を、横 128 ピクセルの色番号の画像にする。足りない分は色 0。 */
export function tilesToPixels(tiles: Uint8Array, tileCount: number = Math.ceil(tiles.length / TILE_BYTES)): IndexedImage {
  const rows = Math.ceil(tileCount / TILES_PER_ROW);
  const width = TILE_IMAGE_WIDTH;
  const height = rows * TILE_PIXELS;
  const pixels = new Uint8Array(width * height);
  for (let t = 0; t < Math.min(tileCount, Math.floor(tiles.length / TILE_BYTES)); t++) {
    const ox = (t % TILES_PER_ROW) * TILE_PIXELS;
    const oy = Math.floor(t / TILES_PER_ROW) * TILE_PIXELS;
    for (let y = 0; y < TILE_PIXELS; y++) {
      for (let x = 0; x < TILE_PIXELS; x += 2) {
        const b = tiles[t * TILE_BYTES + y * 4 + x / 2]!;
        pixels[(oy + y) * width + ox + x] = b & 0xf;
        pixels[(oy + y) * width + ox + x + 1] = b >> 4;
      }
    }
  }
  return { width, height, pixels, palette: new Uint8Array(0) };
}

/** BGR555 の 16 色を PNG の PLTE（RGB × 16）にする。 */
export function paletteToPlte(colors: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(16 * 3);
  for (let i = 0; i < 16; i++) out.set(bgr555ToRgb(colors[i] ?? 0), i * 3);
  return out;
}

/**
 * タイルを 4bpp のインデックス PNG（横 128 ピクセル）にする。`colors` は BGR555 の 16 色。
 * Bochi の CfruTilesetCodec.SaveImage と同じ並び・同じ色（5 ビットを 8 倍）。
 */
export function encodeTilesPng(tiles: Uint8Array, colors: ArrayLike<number>, tileCount?: number, deflate?: DeflateFunction): Uint8Array {
  const image = tilesToPixels(tiles, tileCount);
  return encodeIndexedPng({ ...image, palette: paletteToPlte(colors) }, 4, deflate);
}

/**
 * インデックス PNG を 4bpp タイルにする。幅・高さが 8 の倍数でない、色番号が 15 を超える画像は RangeError。
 * 横幅は 8 の倍数なら何でもよい（左上から横へタイルを数える）。
 */
export function decodeTilesPng(png: Uint8Array, inflate?: InflateFunction): Uint8Array {
  const image = decodeIndexedPng(png, inflate);
  if (image.width % TILE_PIXELS !== 0 || image.height % TILE_PIXELS !== 0) {
    throw new RangeError("画像の大きさが 8 の倍数ではありません");
  }
  if (image.pixels.some((p) => p > 15)) throw new RangeError("15 を超える色番号があります");
  return pixelsToTiles(image.pixels, image.width, image.height);
}
