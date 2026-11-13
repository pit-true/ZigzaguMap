import { DataError } from "./DataError.js";

/** 16 進の大文字（`digits` 桁に 0 で埋める）。表示・ファイル名・JSON の 16 進表記はこれでそろえる。 */
export function formatHex(value: number, digits = 0): string {
  return value.toString(16).toUpperCase().padStart(digits, "0");
}

/** バイト列を 2 桁ずつの 16 進の大文字にする（区切りなし）。 */
export function formatHexBytes(bytes: Iterable<number>): string {
  let s = "";
  for (const b of bytes) s += formatHex(b, 2);
  return s;
}

/** バイト列の `offset` から `length` バイトが収まっているかを確かめ、足りなければ DataError を投げる。 */
export function requireBytes(bytes: Uint8Array, offset: number, length: number, what: string): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + length > bytes.length) {
    throw new DataError(`${what}: データが足りません (位置 ${offset}, 必要 ${length} バイト, 全体 ${bytes.length} バイト)`);
  }
}

/** 符号なし 8 ビット。 */
export function readU8(bytes: Uint8Array, offset: number): number {
  return bytes[offset]!;
}

/** 符号なし 16 ビット（リトルエンディアン）。 */
export function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

/** 符号つき 16 ビット。 */
export function readS16(bytes: Uint8Array, offset: number): number {
  const v = readU16(bytes, offset);
  return v >= 0x8000 ? v - 0x10000 : v;
}

/** 符号なし 32 ビット。 */
export function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

/** 符号つき 32 ビット。 */
export function readS32(bytes: Uint8Array, offset: number): number {
  return readU32(bytes, offset) | 0;
}

/** 8 ビットを書く。 */
export function writeU8(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
}

/** 16 ビットを書く（符号つきの値も下位 16 ビットで書く）。 */
export function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

/** 32 ビットを書く（符号つきの値も下位 32 ビットで書く）。 */
export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/** 2 つのバイト列が同じか。 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** バイト列を連結する。 */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
