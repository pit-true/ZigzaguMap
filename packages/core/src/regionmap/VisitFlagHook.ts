import type { Rom } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { MAPSEC_COUNT, MAPSEC_FIRST, NO_FLAG } from "./constants.js";

/** 表を指すポインタの、関数の先頭からの位置（CFRU のフック 8 バイトの直後）。 */
const TABLE_POINTER_OFFSET = 8;

/** プロジェクトの `hooks` に、この 2 行があればビルドが訪問フラグを ROM へ書く（Chronos の src/town_map_flags.c。#499）。 */
const HOOK_LINES = [/^TownMap_GetMapState\s+0?80C47C0\b/i, /^TownMap_GetCaveState\s+0?80C4A5C\b/i];

/**
 * 訪問フラグ（人ID）を表引きに置き換えたフック（#499）。
 *
 * Chronos は GetMapState / GetCaveState の先頭を CFRU のフック（`ldr rN, [pc, #0]; bx rN; .word 関数`）で置き換え、
 * フックの直後（関数の先頭 + 8）に表へのポインタを置く（`repoints`）。表は地名 0x58〜0xC5 の u16 × 110 で、
 * フラグの無い場所は 0xFFFF。ビルド（map_project.py）とここは、同じポインタから表を読み書きする。
 */
export class VisitFlagHook {
  /**
   * 関数の先頭がフックなら、表を読んで地名番号 → フラグ（フラグの無い場所は含めない）を返す。フックでなければ null。
   * フックなのに表へのポインタが読めなければ RomError。
   */
  static read(rom: Rom, functionOffset: number): Map<number, number> | null {
    if (!VisitFlagHook.isHook(rom, functionOffset)) return null;
    const table = rom.pointer(functionOffset + TABLE_POINTER_OFFSET);
    if (!rom.inRange(table, MAPSEC_COUNT * 2)) throw new RomError(`訪問フラグの表が ROM の外です (0x${table.toString(16)})`);
    const out = new Map<number, number>();
    for (let i = 0; i < MAPSEC_COUNT; i++) {
      const flag = rom.u16(table + i * 2);
      if (flag !== NO_FLAG) out.set(MAPSEC_FIRST + i, flag);
    }
    return out;
  }

  /** 関数の先頭が CFRU のフック（4 バイト境界の `ldr rN, [pc, #0]; bx rN`）か。 */
  static isHook(rom: Rom, functionOffset: number): boolean {
    if (functionOffset % 4 !== 0 || !rom.inRange(functionOffset, TABLE_POINTER_OFFSET + 4)) return false;
    const ldr = rom.u16(functionOffset);
    const bx = rom.u16(functionOffset + 2);
    const reg = (ldr >> 8) & 7;
    return (ldr & 0xf8ff) === 0x4800 && bx === (0x4700 | (reg << 3));
  }

  /** プロジェクトの `hooks` の中身から、ビルドが訪問フラグを ROM へ書くか（2 つのフックがあるか）を見分ける。 */
  static supportedBy(hooksText: string | null): boolean {
    if (hooksText === null) return false;
    const lines = hooksText.split(/\r?\n/).map((l) => l.trim());
    return HOOK_LINES.every((re) => lines.some((l) => re.test(l)));
  }
}
