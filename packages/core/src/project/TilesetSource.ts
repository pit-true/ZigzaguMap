import { DataError } from "../binary/DataError.js";
import { readU32 } from "../binary/bytes.js";
import { TILESET_HEADER_SIZE, TILE_BYTES } from "../map/constants.js";
import type { Tileset } from "../map/types.js";
import { ProjectFormatError } from "./ProjectFormatError.js";
import { parseJsonObject, readBool, readBytes, readInt, readString } from "./jsonRead.js";
import { decodeIndexedPng } from "./png/PngDecoder.js";
import type { InflateFunction } from "./png/inflate.js";

/** tileset.json の Format の値。 */
export const TILESET_SOURCE_FORMAT = 1;
/** パレットのバイト数（16 色 × 16 本 × 2 バイト）。 */
const PALETTE_BYTES = 512;
/** 1 タイルの一辺のピクセル数。 */
const TILE_PIXELS = 8;
/** タイルセットヘッダーの圧縮フラグの位置。 */
const HEADER_COMPRESSED = 0x00;
/** タイルセットヘッダーの副フラグの位置。 */
const HEADER_SECONDARY = 0x01;
/** タイルセットヘッダーのアニメーション関数の位置。 */
const HEADER_CALLBACK = 0x10;

/**
 * maps\tilesets\<id>\tileset.json の中身（Bochi の CfruTilesetSource）。
 * Header はタイル画像・パレット・ブロック・属性のポインタ（0x04〜0x0F、0x14〜0x17）を 0 にした 24 バイト。
 */
export interface TilesetSource {
  format: number;
  /** ヘッダーの位置（ROM 先頭から）。マップの PrimaryTileset / SecondaryTileset は 0x08000000 + この値。 */
  headerAddress: number;
  secondary: boolean;
  /** ベース ROM に無い新しいタイルセットか。 */
  isNew: boolean;
  header: Uint8Array;
  tileCount: number;
  blockCount: number;
  blockBytes: number;
  behaviorBytes: number;
  compressed: boolean;
  /** tiles.png のタイル画像（4bpp）の SHA-256（16 進の大文字）。 */
  imageSha256: string;
  palettes: Uint8Array;
  blocks: Uint8Array;
  behaviors: Uint8Array;
}

/** tileset.json の読み取りと、tiles.png と合わせた Tileset への変換。 */
export class TilesetSourceJson {
  /** tileset.json を読む。形式が不正なら ProjectFormatError。 */
  static parse(text: string, path: string | null = null): TilesetSource {
    const o = parseJsonObject(text, path);
    const s: TilesetSource = {
      format: readInt(o, "Format", path, TILESET_SOURCE_FORMAT),
      headerAddress: readInt(o, "HeaderAddress", path),
      secondary: readBool(o, "Secondary", path),
      isNew: readBool(o, "New", path),
      header: readBytes(o, "Header", path),
      tileCount: readInt(o, "TileCount", path),
      blockCount: readInt(o, "BlockCount", path),
      blockBytes: readInt(o, "BlockBytes", path),
      behaviorBytes: readInt(o, "BehaviorBytes", path),
      compressed: readBool(o, "Compressed", path),
      imageSha256: readString(o, "ImageSha256", path),
      palettes: readBytes(o, "Palettes", path),
      blocks: readBytes(o, "Blocks", path),
      behaviors: readBytes(o, "Behaviors", path),
    };
    if (
      s.format !== TILESET_SOURCE_FORMAT ||
      s.header.length !== TILESET_HEADER_SIZE ||
      s.palettes.length !== PALETTE_BYTES ||
      s.blocks.length !== s.blockCount * s.blockBytes ||
      s.behaviors.length !== s.blockCount * s.behaviorBytes ||
      s.tileCount < 1 ||
      s.tileCount > 1024
    ) {
      throw new ProjectFormatError("タイルセットのソースの形式が不正です", path);
    }
    return s;
  }

  /**
   * tiles.png（4bpp のインデックス PNG、幅 128）を読み、Tileset にする。
   * 画像のタイル数が TileCount と合わなければ DataError。
   */
  static toTileset(source: TilesetSource, png: Uint8Array, inflate?: InflateFunction): Tileset {
    const image = decodeIndexedPng(png, inflate);
    if (image.width % TILE_PIXELS !== 0 || image.height % TILE_PIXELS !== 0) {
      throw new DataError("tiles.png の大きさが 8 の倍数ではありません");
    }
    const tiles = pixelsToTiles(image.pixels, image.width, image.height);
    if (tiles.length < source.tileCount * TILE_BYTES) throw new DataError("tiles.png のタイル数が足りません");
    const h = source.header;
    return {
      header: {
        offset: source.headerAddress,
        isCompressed: h[HEADER_COMPRESSED] !== 0,
        isSecondary: h[HEADER_SECONDARY] !== 0,
        // maps\ から読んだタイルセットには ROM 上の位置が無いので 0 にする。
        tilesOffset: 0,
        palettesOffset: 0,
        blocksOffset: 0,
        callback: readU32(h, HEADER_CALLBACK),
        attributesOffset: 0,
      },
      tiles: tiles.subarray(0, source.tileCount * TILE_BYTES),
      palettes: toU16(source.palettes),
      blocks: toU16(source.blocks),
      attributes: toU32(source.behaviors, source.behaviorBytes),
    };
  }

  // TODO: tileset.json と tiles.png の書き出し（ImageSha256 の計算、4bpp PNG のエンコード、Bochi と同じ整形）。
}

/** 色番号の画像（幅×高さ）を 4bpp タイル（左上から横へ並べた順）にする。 */
export function pixelsToTiles(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const perRow = width / TILE_PIXELS;
  const count = perRow * (height / TILE_PIXELS);
  const out = new Uint8Array(count * TILE_BYTES);
  for (let t = 0; t < count; t++) {
    const ox = (t % perRow) * TILE_PIXELS;
    const oy = Math.floor(t / perRow) * TILE_PIXELS;
    for (let y = 0; y < TILE_PIXELS; y++) {
      for (let x = 0; x < TILE_PIXELS; x += 2) {
        const p = (oy + y) * width + ox + x;
        out[t * TILE_BYTES + y * 4 + x / 2] = (pixels[p]! & 0xf) | ((pixels[p + 1]! & 0xf) << 4);
      }
    }
  }
  return out;
}

function toU16(bytes: Uint8Array): Uint16Array {
  const out = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
  return out;
}

function toU32(bytes: Uint8Array, unit: number): Uint32Array {
  const count = unit > 0 ? Math.floor(bytes.length / unit) : 0;
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    let v = 0;
    for (let b = Math.min(unit, 4) - 1; b >= 0; b--) v = (v << 8) | bytes[i * unit + b]!;
    out[i] = v >>> 0;
  }
  return out;
}
