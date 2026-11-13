import { DataError } from "../../binary/DataError.js";
import { concatBytes } from "../../binary/bytes.js";
import { inflateZlib, type InflateFunction } from "./inflate.js";

/** PNG の先頭 8 バイト。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 色の種類: グレースケール。 */
const COLOR_GRAY = 0;
/** 色の種類: インデックス（パレット）。 */
const COLOR_INDEXED = 3;

/** インデックス PNG を読んだ結果。 */
export interface IndexedImage {
  readonly width: number;
  readonly height: number;
  /** 1 ピクセル 1 バイトの色番号（幅×高さ）。 */
  readonly pixels: Uint8Array;
  /** パレット（RGB の並び）。無ければ空。 */
  readonly palette: Uint8Array;
}

/**
 * インデックス PNG（ビット深度 1/2/4/8）とグレースケール PNG を、色番号の配列として読む。
 * インターレースには対応しない。展開関数は差し替えられる（省略時は内蔵の inflate）。
 */
export function decodeIndexedPng(png: Uint8Array, inflate: InflateFunction = inflateZlib): IndexedImage {
  if (png.length < 8 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new DataError("PNG ではありません");
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let palette = new Uint8Array(0);
  const idat: Uint8Array[] = [];
  while (at + 8 <= png.length) {
    const length = readBE32(png, at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    const body = at + 8;
    if (body + length + 4 > png.length) throw new DataError(`PNG: ${type} チャンクが途中で切れています`);
    const data = png.subarray(body, body + length);
    if (type === "IHDR") {
      width = readBE32(data, 0);
      height = readBE32(data, 4);
      depth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw new DataError("PNG: インターレースには対応していません");
    } else if (type === "PLTE") {
      palette = data.slice();
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    at = body + length + 4;
  }
  if (colorType !== COLOR_INDEXED && colorType !== COLOR_GRAY) throw new DataError(`PNG: 色の種類 ${colorType} には対応していません`);
  if (![1, 2, 4, 8].includes(depth)) throw new DataError(`PNG: ビット深度 ${depth} には対応していません`);
  if (width === 0 || height === 0) throw new DataError("PNG: 大きさが不正です");

  const raw = inflate(concatBytes(idat));
  const stride = Math.ceil((width * depth) / 8);
  if (raw.length < (stride + 1) * height) throw new DataError("PNG: 画像データが足りません");
  const bpp = 1; // 1 ピクセルのバイト数（8 ビット以下なので 1）
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp]! : 0;
      const b = prev ? prev[x]! : 0;
      const c = prev && x >= bpp ? prev[x - bpp]! : 0;
      let v = src[x]!;
      switch (filter) {
        case 0:
          break;
        case 1:
          v += a;
          break;
        case 2:
          v += b;
          break;
        case 3:
          v += (a + b) >> 1;
          break;
        case 4:
          v += paeth(a, b, c);
          break;
        default:
          throw new DataError(`PNG: 不正なフィルター ${filter}`);
      }
      row[x] = v & 0xff;
    }
  }

  const pixels = new Uint8Array(width * height);
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = rows[y * stride + Math.floor(x / perByte)]!;
      const shift = 8 - depth * ((x % perByte) + 1);
      pixels[y * width + x] = (byte >> shift) & mask;
    }
  }
  return { width, height, pixels, palette };
}

function readBE32(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
