import { DataError } from "../binary/DataError.js";
import { readU16, readU32, writeU16, writeU32 } from "../binary/bytes.js";

/**
 * AdvanceMap の「作成したマップ」ファイル（`.map`）の中身。
 * タイルセットはポインタではなく AdvanceMap のタイルセット番号（0〜67）で持つ。
 */
export interface AmMapData {
  readonly width: number;
  readonly height: number;
  /** タイルセット 1（主）の番号。 */
  readonly primaryTileset: number;
  /** タイルセット 2（副）の番号。 */
  readonly secondaryTileset: number;
  readonly borderWidth: number;
  readonly borderHeight: number;
  /** 境界ブロック（borderWidth × borderHeight）。 */
  readonly border: Uint16Array;
  /** 配置（width × height。1 マスは u16 = ブロック番号と移動許可）。 */
  readonly cells: Uint16Array;
}

/** 新しい形式の先頭部分（幅・高さ・タイルセット 2 つの u32 と、境界の幅・高さ・2 バイト）のバイト数。 */
export const AM_MAP_HEAD_SIZE = 20;
/**
 * 先頭部分の 0x12〜0x13。AdvanceMap 1.92 はいつも `C0 00` を書く（意味は不明。読むときは見ない）。
 */
export const AM_MAP_HEAD_MARK = 0x00c0;
/** 古い形式（境界 2×2 + 配置 + 末尾に幅・高さ・タイルセット 2 つ）の境界と末尾のバイト数。 */
const OLD_BORDER_SIZE = 8;
const OLD_TAIL_SIZE = 16;
/** 読むときに受け付ける幅・高さの上限（壊れたファイルで大きな配列を作らないため）。 */
const MAX_SIDE = 0x4000;

/**
 * `.map` を読む。AdvanceMap 1.92 が書く形式（先頭に大きさとタイルセット、境界、配置）と、
 * 古い版の形式（境界 2×2、配置、末尾に大きさとタイルセット。同梱の `Maps\*.map`）の両方を読む。
 * どちらとも長さが合わなければ DataError。
 */
export function decodeAmMap(bytes: Uint8Array): AmMapData {
  const current = tryCurrent(bytes);
  if (current) return current;
  const old = tryOld(bytes);
  if (old) return old;
  throw new DataError(`AdvanceMap のマップファイルとして読めません（${bytes.length} バイト）`);
}

/** `.map` を AdvanceMap 1.92 と同じ形式で書く。 */
export function encodeAmMap(data: AmMapData): Uint8Array {
  const { width, height, borderWidth, borderHeight } = data;
  if (data.cells.length !== width * height) throw new RangeError("配置の大きさが合いません");
  if (data.border.length !== borderWidth * borderHeight) throw new RangeError("境界ブロックの大きさが合いません");
  if (borderWidth > 0xff || borderHeight > 0xff) throw new RangeError("境界ブロックが大きすぎます");
  const out = new Uint8Array(AM_MAP_HEAD_SIZE + (data.border.length + data.cells.length) * 2);
  writeU32(out, 0x00, width);
  writeU32(out, 0x04, height);
  writeU32(out, 0x08, data.primaryTileset);
  writeU32(out, 0x0c, data.secondaryTileset);
  out[0x10] = borderWidth;
  out[0x11] = borderHeight;
  writeU16(out, 0x12, AM_MAP_HEAD_MARK);
  let at = AM_MAP_HEAD_SIZE;
  for (const v of data.border) {
    writeU16(out, at, v);
    at += 2;
  }
  for (const v of data.cells) {
    writeU16(out, at, v);
    at += 2;
  }
  return out;
}

function tryCurrent(bytes: Uint8Array): AmMapData | null {
  if (bytes.length < AM_MAP_HEAD_SIZE) return null;
  const width = readU32(bytes, 0x00);
  const height = readU32(bytes, 0x04);
  const borderWidth = bytes[0x10]!;
  const borderHeight = bytes[0x11]!;
  if (!plausible(width, height)) return null;
  const borderCount = borderWidth * borderHeight;
  if (bytes.length !== AM_MAP_HEAD_SIZE + (borderCount + width * height) * 2) return null;
  return {
    width,
    height,
    primaryTileset: readU32(bytes, 0x08),
    secondaryTileset: readU32(bytes, 0x0c),
    borderWidth,
    borderHeight,
    border: readCells(bytes, AM_MAP_HEAD_SIZE, borderCount),
    cells: readCells(bytes, AM_MAP_HEAD_SIZE + borderCount * 2, width * height),
  };
}

function tryOld(bytes: Uint8Array): AmMapData | null {
  if (bytes.length < OLD_BORDER_SIZE + OLD_TAIL_SIZE) return null;
  const tail = bytes.length - OLD_TAIL_SIZE;
  const width = readU32(bytes, tail);
  const height = readU32(bytes, tail + 4);
  if (!plausible(width, height) || bytes.length !== OLD_BORDER_SIZE + width * height * 2 + OLD_TAIL_SIZE) return null;
  return {
    width,
    height,
    primaryTileset: readU32(bytes, tail + 8),
    secondaryTileset: readU32(bytes, tail + 12),
    borderWidth: 2,
    borderHeight: 2,
    border: readCells(bytes, 0, 4),
    cells: readCells(bytes, OLD_BORDER_SIZE, width * height),
  };
}

function plausible(width: number, height: number): boolean {
  return width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE;
}

function readCells(bytes: Uint8Array, offset: number, count: number): Uint16Array {
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = readU16(bytes, offset + i * 2);
  return out;
}
