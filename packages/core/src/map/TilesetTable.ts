import type { GameOffsets } from "../game/offsets.js";
import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { TILESET_HEADER_SIZE } from "./constants.js";

/**
 * ROM のタイルセットヘッダーの表（AdvanceMap のタイルセット番号 0〜67 の並び）。
 * 番号とマップの PrimaryTileset / SecondaryTileset（ポインタ値）を相互に変換する。
 */
export class TilesetTable {
  /** 各タイルセットのポインタ値（0x08000000 起点）。表が ROM に収まらない部分は含まない。 */
  readonly pointers: readonly number[];

  private constructor(pointers: number[]) {
    this.pointers = pointers;
  }

  /** ROM から読む。 */
  static read(rom: Rom, offsets: GameOffsets): TilesetTable {
    const pointers: number[] = [];
    for (let i = 0; i < offsets.tilesetCount; i++) {
      const at = offsets.tilesetHeaderTable + i * TILESET_HEADER_SIZE;
      if (!rom.inRange(at, TILESET_HEADER_SIZE)) break;
      pointers.push(ROM_BASE + at);
    }
    return new TilesetTable(pointers);
  }

  /** タイルセットの数。 */
  get count(): number {
    return this.pointers.length;
  }

  /** 番号 → ポインタ値。範囲外なら null。 */
  pointerOf(index: number): number | null {
    return this.pointers[index] ?? null;
  }

  /** ポインタ値 → 番号。表に無ければ null。 */
  indexOf(pointer: number): number | null {
    const i = this.pointers.indexOf(pointer >>> 0);
    return i < 0 ? null : i;
  }

  /** 表の全タイルセットのデータ（画像・パレット・ブロック・属性）の開始位置（ROM 先頭から、昇順）。 */
  dataStarts(rom: Rom): number[] {
    const starts = new Set<number>();
    for (const pointer of this.pointers) {
      const at = pointer - ROM_BASE;
      starts.add(at);
      for (const field of [0x04, 0x08, 0x0c, 0x14]) {
        const value = rom.u32(at + field);
        if (rom.isPointer(value)) starts.add(value - ROM_BASE);
      }
    }
    return [...starts].sort((a, b) => a - b);
  }
}
