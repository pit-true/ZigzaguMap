import { deflateZlib, type DeflateFunction } from "./deflate.js";

/** PNG の先頭 8 バイト。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 色の種類: インデックス（パレット）。 */
const COLOR_INDEXED = 3;

/** インデックス PNG に書く画像。 */
export interface IndexedImageInput {
  readonly width: number;
  readonly height: number;
  /** 1 ピクセル 1 バイトの色番号（幅×高さ）。 */
  readonly pixels: Uint8Array;
  /** パレット（RGB の並び。色数 × 3 バイト）。 */
  readonly palette: Uint8Array;
}

/**
 * インデックス PNG（ビット深度 1/2/4/8）を作る。フィルターは使わない（各行 0）。
 * 色番号が `2^depth` 以上なら RangeError。圧縮関数は差し替えられる（省略時は内蔵の deflate）。
 */
export function encodeIndexedPng(image: IndexedImageInput, depth: 1 | 2 | 4 | 8 = 8, deflate: DeflateFunction = deflateZlib): Uint8Array {
  const { width, height, pixels, palette } = image;
  if (pixels.length !== width * height) throw new RangeError("画像の大きさとピクセル数が合いません");
  const limit = 1 << depth;
  const stride = Math.ceil((width * depth) / 8);
  const raw = new Uint8Array((stride + 1) * height);
  const perByte = 8 / depth;
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x]!;
      if (v >= limit) throw new RangeError(`色番号 ${v} は ${depth} ビットに収まりません`);
      const shift = 8 - depth * ((x % perByte) + 1);
      const at = row + Math.floor(x / perByte);
      raw[at] = raw[at]! | (v << shift);
    }
  }
  const ihdr = new Uint8Array(13);
  writeBE32(ihdr, 0, width);
  writeBE32(ihdr, 4, height);
  ihdr[8] = depth;
  ihdr[9] = COLOR_INDEXED;
  const chunks = [chunk("IHDR", ihdr), chunk("PLTE", palette), chunk("IDAT", deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const total = PNG_SIGNATURE.length + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  let at = PNG_SIGNATURE.length;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeBE32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeBE32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

let crcTable: Uint32Array | null = null;

/** CRC-32（PNG のチャンク用）。 */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeBE32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}
