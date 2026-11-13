import { RomError } from "./RomError.js";
import { decompressLz77 } from "./lz77.js";

/** GBA の ROM 領域の先頭アドレス。 */
export const ROM_BASE = 0x08000000;

/** ROM のバイト列を包み、範囲チェックつきで読み取るクラス。書き込みはしない。 */
export class Rom {
  /** ROM 全体のバイト列。 */
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** ROM のバイト数。 */
  get size(): number {
    return this.bytes.length;
  }

  /** `offset` から `length` バイトが ROM 内に収まるか。 */
  inRange(offset: number, length = 1): boolean {
    return Number.isInteger(offset) && offset >= 0 && length >= 0 && offset + length <= this.bytes.length;
  }

  /** 範囲外なら RomError を投げる。 */
  check(offset: number, length: number): void {
    if (!this.inRange(offset, length)) {
      throw new RomError(`範囲外の読み取りです: 0x${offset.toString(16)} (+${length})`);
    }
  }

  /** 符号なし 8 ビット。 */
  u8(offset: number): number {
    this.check(offset, 1);
    return this.bytes[offset]!;
  }

  /** 符号なし 16 ビット（リトルエンディアン）。 */
  u16(offset: number): number {
    this.check(offset, 2);
    return this.bytes[offset]! | (this.bytes[offset + 1]! << 8);
  }

  /** 符号なし 32 ビット（リトルエンディアン）。 */
  u32(offset: number): number {
    this.check(offset, 4);
    const b = this.bytes;
    return (b[offset]! | (b[offset + 1]! << 8) | (b[offset + 2]! << 16) | (b[offset + 3]! << 24)) >>> 0;
  }

  /** 符号つき 8 ビット。 */
  s8(offset: number): number {
    const v = this.u8(offset);
    return v >= 0x80 ? v - 0x100 : v;
  }

  /** 符号つき 32 ビット。 */
  s32(offset: number): number {
    return this.u32(offset) | 0;
  }

  /** 値が ROM 内を指すポインタ（0x08000000 起点）か。 */
  isPointer(value: number): boolean {
    const offset = value - ROM_BASE;
    return offset >= 0 && offset < this.bytes.length;
  }

  /** ポインタを読み、ROM 内のオフセットにして返す。ROM 外なら RomError。 */
  pointer(offset: number): number {
    const value = this.u32(offset);
    if (!this.isPointer(value)) {
      throw new RomError(`ROM 外を指すポインタです: 0x${value.toString(16)} (位置 0x${offset.toString(16)})`);
    }
    return value - ROM_BASE;
  }

  /** ポインタを読み、NULL(0) なら null、ROM 内ならオフセット、それ以外は RomError。 */
  pointerOrNull(offset: number): number | null {
    return this.u32(offset) === 0 ? null : this.pointer(offset);
  }

  /** `offset` から `length` バイトのコピーではなく部分ビューを返す。 */
  slice(offset: number, length: number): Uint8Array {
    this.check(offset, length);
    return this.bytes.subarray(offset, offset + length);
  }

  /** `offset` から `count` 個の u16 を読む。 */
  u16Array(offset: number, count: number): Uint16Array {
    this.check(offset, count * 2);
    const out = new Uint16Array(count);
    for (let i = 0; i < count; i++) out[i] = this.bytes[offset + i * 2]! | (this.bytes[offset + i * 2 + 1]! << 8);
    return out;
  }

  /** `offset` の LZ77 圧縮データを展開する。 */
  lz77(offset: number): Uint8Array {
    return decompressLz77(this.bytes, offset);
  }

  /** ASCII 文字列（NUL で終端）を読む。 */
  ascii(offset: number, length: number): string {
    const raw = this.slice(offset, length);
    let s = "";
    for (const c of raw) {
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}
