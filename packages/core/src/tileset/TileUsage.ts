/**
 * 未使用のタイル（ブロックエディタの 表示 > 未使用のタイル。Phase5 #395）。DOM に依存しない計算だけを置く。
 *
 * - 主のタイル（0〜0x27F）は、主のブロックと、同じ主を使う全部の組の副のブロックから数える
 *   （副のブロックも主のタイルを指せるため）。
 * - 副のタイル（0x280〜）は、今の副のブロックと、主のブロックから数える（主のブロックが副のタイルを指すと、組の副のタイルになる）。
 * - ブロックの 8 タイルをどれも数える（3 層の次の番号の下層＝3 層目も含む）。
 */
import { PRIMARY_TILE_COUNT, TOTAL_TILE_COUNT } from "../map/constants.js";

/** 数える材料。 */
export interface TileUsageInput {
  /** 主のブロック定義（1 ブロック 8 個の u16）。 */
  readonly primaryBlocks: Uint16Array;
  /** 今の副のブロック定義。 */
  readonly secondaryBlocks: Uint16Array;
  /** 同じ主を使うほかの副のブロック定義（主のタイルだけに数える）。 */
  readonly otherSecondaryBlocks: readonly Uint16Array[];
  /** 主・副のタイルの数。 */
  readonly primaryTileCount: number;
  readonly secondaryTileCount: number;
}

/** 使われているタイルの印（通し番号 0〜1023）。 */
export function usedTileFlags(input: TileUsageInput): Uint8Array {
  const used = new Uint8Array(TOTAL_TILE_COUNT);
  const mark = (blocks: Uint16Array, primaryOnly: boolean): void => {
    for (const v of blocks) {
      const tile = v & 0x3ff;
      if (!primaryOnly || tile < PRIMARY_TILE_COUNT) used[tile] = 1;
    }
  };
  mark(input.primaryBlocks, false);
  mark(input.secondaryBlocks, false);
  for (const b of input.otherSecondaryBlocks) mark(b, true);
  return used;
}

/** 未使用のタイルの通し番号（主はタイルの数まで、副は 0x280 から副のタイルの数まで）。 */
export function unusedTiles(input: TileUsageInput): number[] {
  const used = usedTileFlags(input);
  const out: number[] = [];
  for (let t = 0; t < Math.min(input.primaryTileCount, PRIMARY_TILE_COUNT); t++) if (!used[t]) out.push(t);
  const end = PRIMARY_TILE_COUNT + Math.min(input.secondaryTileCount, TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT);
  for (let t = PRIMARY_TILE_COUNT; t < end; t++) if (!used[t]) out.push(t);
  return out;
}
