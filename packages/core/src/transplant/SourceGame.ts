/**
 * 移植の元にする ROM（別の ROM）の種類と、ゲームごとの決まった値。
 * 対象は #319 の Q8 の推奨（FR・LG の日本語版と英語版、エメラルドの日本語版と英語版）。
 * 表の位置はゲームコードで決め打ちせず、表を引く関数の機械語を探して求める（改造 ROM でも当たる）。
 */
import type { Rom } from "../rom/Rom.js";

/** ゲームの系統。 */
export type SourceFamily = "frlg" | "emerald";

/** 系統ごとの決まった値。 */
export interface SourceGameSpec {
  readonly family: SourceFamily;
  /** 主タイルセットのタイル数（これ以降の番号は副）。 */
  readonly primaryTiles: number;
  /** 主タイルセットのブロック数（これ以降の番号は副）。 */
  readonly primaryBlocks: number;
  /** 主タイルセットが使うパレットの数（0 から）。 */
  readonly primaryPalettes: number;
  /** 属性 1 個のバイト数。 */
  readonly attributeBytes: 2 | 4;
  /** フッター（レイアウト）のバイト数。 */
  readonly layoutBytes: number;
}

/** FR・LG。 */
export const FRLG_SPEC: SourceGameSpec = { family: "frlg", primaryTiles: 640, primaryBlocks: 640, primaryPalettes: 7, attributeBytes: 4, layoutBytes: 28 };
/** エメラルド。 */
export const EMERALD_SPEC: SourceGameSpec = { family: "emerald", primaryTiles: 512, primaryBlocks: 512, primaryPalettes: 6, attributeBytes: 2, layoutBytes: 24 };

/** VRAM のタイルとブロックの総数（どちらの系統も同じ）。 */
export const SOURCE_TOTAL_TILES = 1024;
export const SOURCE_TOTAL_BLOCKS = 1024;

/** 判定したゲーム。 */
export interface SourceGame {
  /** ゲームコード（BPRJ など）。 */
  readonly code: string;
  readonly spec: SourceGameSpec;
  /** 日本語版か（地名を読むかどうか）。 */
  readonly japanese: boolean;
}

/** ゲームコードから判定する。対象外なら null。 */
export function sourceGameOf(code: string): SourceGame | null {
  const head = code.slice(0, 3);
  const spec = head === "BPR" || head === "BPG" ? FRLG_SPEC : head === "BPE" ? EMERALD_SPEC : null;
  return spec ? { code, spec, japanese: code[3] === "J" } : null;
}

/**
 * マップバンク表を引く関数（Overworld_GetMapHeaderByGroupAndId に当たる）の機械語:
 * lsl r0,#16 / lsl r1,#16 / ldr r2,[pc,#0xC] / lsr r0,#14 / add r0,r2 / ldr r0,[r0] / lsr r1,#14 / add r1,r0 / ldr r0,[r1] / bx lr
 * FR・LG・エメラルドの日本語版と英語版で同じ（ldr の先の 4 バイトがバンク表へのポインタ）。
 */
const MAP_BANK_CODE = Uint8Array.from([0x00, 0x04, 0x09, 0x04, 0x03, 0x4a, 0x80, 0x0b, 0x80, 0x18, 0x00, 0x68, 0x89, 0x0b, 0x09, 0x18, 0x08, 0x68, 0x70, 0x47]);

/**
 * FR・LG の地名の表を引く処理の機械語の一部（ldr r0,[pc,#0x10] の直後: lsl r1,r5,#2 / add r1,r0 / ldr r1,[r1] / mov r0,r6）。
 * 地名の表（地名番号 0x58 からのポインタの並び）へのポインタは、この 2 バイト前の ldr の先にある。
 */
const MAP_NAME_CODE = Uint8Array.from([0xa9, 0x00, 0x09, 0x18, 0x09, 0x68, 0x30, 0x1c]);

/** `pattern` が最初に出てくる位置（無ければ -1）。2 バイト境界だけを見る。 */
export function findCode(bytes: Uint8Array, pattern: Uint8Array, from = 0): number {
  const first = pattern[0]!;
  const end = bytes.length - pattern.length;
  for (let i = from + (from & 1); i <= end; i += 2) {
    if (bytes[i] !== first) continue;
    let k = 1;
    while (k < pattern.length && bytes[i + k] === pattern[k]) k++;
    if (k === pattern.length) return i;
  }
  return -1;
}

/** マップバンク表へのポインタが置かれている位置（ROM 先頭から）。見つからなければ null。 */
export function findMapBankTablePointer(rom: Rom): number | null {
  const at = findCode(rom.bytes, MAP_BANK_CODE);
  if (at < 0) return null;
  // ldr r2,[pc,#0xC] は at+4 にある。pc は 4 バイト境界に切り下げた (at+4)+4。
  const literal = ((at + 8) & ~3) + 0x0c;
  return rom.inRange(literal, 4) && rom.isPointer(rom.u32(literal)) ? literal : null;
}

/** FR・LG の地名の表へのポインタが置かれている位置。エメラルドや見つからないときは null。 */
export function findMapNameTablePointer(rom: Rom, game: SourceGame): number | null {
  if (game.spec.family !== "frlg") return null;
  const at = findCode(rom.bytes, MAP_NAME_CODE);
  if (at < 2) return null;
  const ldr = at - 2;
  if (rom.bytes[ldr + 1] !== 0x48) return null;
  const literal = ((ldr + 4) & ~3) + rom.bytes[ldr]! * 4;
  return rom.inRange(literal, 4) && rom.isPointer(rom.u32(literal)) ? literal : null;
}
