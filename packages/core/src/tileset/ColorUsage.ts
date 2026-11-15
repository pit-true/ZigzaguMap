/**
 * パレットの色の使用箇所（パレットエディタの 表示 > 未使用の色、ツール > 色の使用箇所…。Phase5 #396）。DOM に依存しない計算だけを置く。
 *
 * - 表示中のマップの組（主と副）のブロックの 8 タイルのうち、パレット番号が `palette` のものを見て、
 *   そのタイルの点（4bpp の 0〜15）に出てくる色を数える。
 * - タイルの番号 0〜0x27F は主のタイル、0x280〜は副のタイル（組の中の通し番号）。数の外のタイルは見ない。
 * - 色 0 は透明だが、点に出てくれば使っているとみなす。
 */
import { PRIMARY_BLOCK_COUNT, PRIMARY_TILE_COUNT } from "../map/constants.js";

/** 1 タイル（8×8、4bpp）のバイト数。 */
const TILE_BYTES = 32;

/** 数える材料。 */
export interface ColorUsageInput {
  /** 主・副のブロック定義（1 ブロック 8 個の u16）。 */
  readonly primaryBlocks: Uint16Array;
  readonly secondaryBlocks: Uint16Array;
  /** 主・副のタイル（4bpp）。 */
  readonly primaryTiles: Uint8Array;
  readonly secondaryTiles: Uint8Array;
  /** 見るパレット（0〜15）。 */
  readonly palette: number;
}

/** 色の番号（0〜15）ごとの、その色を使うブロック（一覧の通し番号。副は 640 から）。 */
export function colorUsage(input: ColorUsageInput): number[][] {
  const out: number[][] = Array.from({ length: 16 }, () => []);
  // タイルごとの使う色（16 ビットの印）を、要るときだけ求めて覚える
  const masks = new Map<number, number>();
  const maskOf = (tile: number): number => {
    let m = masks.get(tile);
    if (m !== undefined) return m;
    const bytes = tile < PRIMARY_TILE_COUNT ? input.primaryTiles : input.secondaryTiles;
    const o = (tile < PRIMARY_TILE_COUNT ? tile : tile - PRIMARY_TILE_COUNT) * TILE_BYTES;
    m = 0;
    if (o + TILE_BYTES <= bytes.length) {
      for (let i = 0; i < TILE_BYTES; i++) {
        const b = bytes[o + i]!;
        m |= (1 << (b & 0xf)) | (1 << (b >> 4));
      }
    }
    masks.set(tile, m);
    return m;
  };
  const scan = (blocks: Uint16Array, base: number): void => {
    const count = Math.floor(blocks.length / 8);
    for (let b = 0; b < count; b++) {
      let m = 0;
      for (let k = 0; k < 8; k++) {
        const ref = blocks[b * 8 + k]!;
        if (((ref >> 12) & 0xf) === input.palette) m |= maskOf(ref & 0x3ff);
      }
      for (let c = 0; c < 16; c++) if (m & (1 << c)) out[c]!.push(base + b);
    }
  };
  scan(input.primaryBlocks, 0);
  scan(input.secondaryBlocks, PRIMARY_BLOCK_COUNT);
  return out;
}

/** どのブロックのどの点にも使われていない色の番号。 */
export function unusedColors(input: ColorUsageInput): number[] {
  return colorUsage(input).flatMap((blocks, c) => (blocks.length === 0 ? [c] : []));
}
