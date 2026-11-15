import { DataError } from "../../binary/DataError.js";
import { concatBytes } from "../../binary/bytes.js";
import { inflateZlib, type InflateFunction } from "./inflate.js";

/** PNG の先頭 8 バイト。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** 色の種類: グレースケール。 */
const COLOR_GRAY = 0;
/** 色の種類: RGB。 */
const COLOR_RGB = 2;
/** 色の種類: インデックス（パレット）。 */
const COLOR_INDEXED = 3;
/** 色の種類: グレースケール＋アルファ。 */
const COLOR_GRAY_ALPHA = 4;
/** 色の種類: RGBA。 */
const COLOR_RGBA = 6;
/** 色の種類ごとの 1 画素の成分の数。 */
const CHANNELS: Readonly<Record<number, number>> = { [COLOR_GRAY]: 1, [COLOR_RGB]: 3, [COLOR_INDEXED]: 1, [COLOR_GRAY_ALPHA]: 2, [COLOR_RGBA]: 4 };
/** 色の種類ごとの使えるビット深度。 */
const DEPTHS: Readonly<Record<number, readonly number[]>> = {
  [COLOR_GRAY]: [1, 2, 4, 8, 16],
  [COLOR_RGB]: [8, 16],
  [COLOR_INDEXED]: [1, 2, 4, 8],
  [COLOR_GRAY_ALPHA]: [8, 16],
  [COLOR_RGBA]: [8, 16],
};

/** インデックス PNG を読んだ結果。 */
export interface IndexedImage {
  readonly width: number;
  readonly height: number;
  /** 1 ピクセル 1 バイトの色番号（幅×高さ）。 */
  readonly pixels: Uint8Array;
  /** パレット（RGB の並び）。無ければ空。 */
  readonly palette: Uint8Array;
}

/** 色の種類を問わずに読んだ結果（1 画素 4 バイトの RGBA）。 */
export interface RgbaPng {
  readonly width: number;
  readonly height: number;
  /** R・G・B・A の並び（幅×高さ×4）。16 ビットの成分は上位 8 ビット。 */
  readonly rgba: Uint8Array;
}

/** チャンクを読んで、フィルターを戻した行（各行の先頭のフィルターの 1 バイトは除く）。 */
interface PngRaster {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly colorType: number;
  readonly palette: Uint8Array;
  /** tRNS チャンク（無ければ null）。 */
  readonly trns: Uint8Array | null;
  readonly stride: number;
  readonly rows: Uint8Array;
}

/**
 * インデックス PNG（ビット深度 1/2/4/8）とグレースケール PNG を、色番号の配列として読む。
 * インターレースには対応しない。展開関数は差し替えられる（省略時は内蔵の inflate）。
 */
export function decodeIndexedPng(png: Uint8Array, inflate: InflateFunction = inflateZlib): IndexedImage {
  const r = readRaster(png, inflate);
  if (r.colorType !== COLOR_INDEXED && r.colorType !== COLOR_GRAY) throw new DataError(`PNG: 色の種類 ${r.colorType} には対応していません`);
  if (r.depth > 8) throw new DataError(`PNG: ビット深度 ${r.depth} には対応していません`);
  return { width: r.width, height: r.height, pixels: unpackSamples(r), palette: r.palette };
}

/**
 * どの色の種類の PNG（グレー・RGB・インデックス・グレー＋アルファ・RGBA。ビット深度は PNG の決まりの全部）も RGBA で読む
 * （画像からタイルとブロックを作る。Phase6 #440）。tRNS チャンク（インデックスのアルファ、グレーと RGB の透明色）も見る。
 * 色の補正（gAMA・sRGB・iCCP）はかけない（GBA の色にそのまま丸めるため。WebView の Canvas で読むと補正されることがある）。
 */
export function decodeRgbaPng(png: Uint8Array, inflate: InflateFunction = inflateZlib): RgbaPng {
  const r = readRaster(png, inflate);
  const { width, height, colorType, depth, trns } = r;
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  if (colorType === COLOR_INDEXED) {
    const pixels = unpackSamples(r);
    const colors = r.palette.length / 3;
    for (let i = 0; i < n; i++) {
      const v = pixels[i]!;
      if (v >= colors) throw new DataError(`PNG: 色番号 ${v} がパレットにありません`);
      rgba[i * 4] = r.palette[v * 3]!;
      rgba[i * 4 + 1] = r.palette[v * 3 + 1]!;
      rgba[i * 4 + 2] = r.palette[v * 3 + 2]!;
      rgba[i * 4 + 3] = trns && v < trns.length ? trns[v]! : 255;
    }
    return { width, height, rgba };
  }
  if (colorType === COLOR_GRAY && depth < 8) {
    const pixels = unpackSamples(r);
    const max = (1 << depth) - 1;
    const key = trns && trns.length >= 2 ? ((trns[0]! << 8) | trns[1]!) & max : -1;
    for (let i = 0; i < n; i++) {
      const v = pixels[i]!;
      const g = Math.round((v * 255) / max);
      rgba.set([g, g, g, v === key ? 0 : 255], i * 4);
    }
    return { width, height, rgba };
  }
  // 8・16 ビットの成分
  const channels = CHANNELS[colorType]!;
  const wide = depth === 16;
  const sample = (row: number, x: number, c: number): number => {
    const at = row * r.stride + (x * channels + c) * (wide ? 2 : 1);
    return wide ? (r.rows[at]! << 8) | r.rows[at + 1]! : r.rows[at]!;
  };
  const top = (v: number): number => (wide ? v >> 8 : v);
  const key = trnsKey(colorType, trns);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === COLOR_GRAY || colorType === COLOR_GRAY_ALPHA) {
        const g = sample(y, x, 0);
        const a = colorType === COLOR_GRAY_ALPHA ? top(sample(y, x, 1)) : key && g === key[0] ? 0 : 255;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = top(g);
        rgba[o + 3] = a;
      } else {
        const red = sample(y, x, 0);
        const green = sample(y, x, 1);
        const blue = sample(y, x, 2);
        rgba[o] = top(red);
        rgba[o + 1] = top(green);
        rgba[o + 2] = top(blue);
        rgba[o + 3] = colorType === COLOR_RGBA ? top(sample(y, x, 3)) : key && red === key[0] && green === key[1] && blue === key[2] ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
}

/** グレー・RGB の tRNS（透明にする色。成分ごとに 16 ビット）。 */
function trnsKey(colorType: number, trns: Uint8Array | null): number[] | null {
  if (!trns) return null;
  const count = colorType === COLOR_GRAY ? 1 : colorType === COLOR_RGB ? 3 : 0;
  if (count === 0 || trns.length < count * 2) return null;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((trns[i * 2]! << 8) | trns[i * 2 + 1]!);
  return out;
}

function readRaster(png: Uint8Array, inflate: InflateFunction): PngRaster {
  if (png.length < 8 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new DataError("PNG ではありません");
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let palette = new Uint8Array(0);
  let trns: Uint8Array | null = null;
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
    } else if (type === "tRNS") {
      trns = data.slice();
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    at = body + length + 4;
  }
  const channels = CHANNELS[colorType];
  if (channels === undefined) throw new DataError(`PNG: 色の種類 ${colorType} には対応していません`);
  if (!DEPTHS[colorType]!.includes(depth)) throw new DataError(`PNG: ビット深度 ${depth} には対応していません`);
  if (width === 0 || height === 0) throw new DataError("PNG: 大きさが不正です");

  const raw = inflate(concatBytes(idat));
  const bits = channels * depth;
  const stride = Math.ceil((width * bits) / 8);
  if (raw.length < (stride + 1) * height) throw new DataError("PNG: 画像データが足りません");
  // フィルターで左に見る画素のバイト数（8 ビット未満は 1）
  const bpp = Math.max(1, bits >> 3);
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
  return { width, height, depth, colorType, palette, trns, stride, rows };
}

/** 1 成分 8 ビット以下の画像の、1 画素 1 バイトの値。 */
function unpackSamples(r: PngRaster): Uint8Array {
  const { width, height, depth, stride, rows } = r;
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
  return pixels;
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
