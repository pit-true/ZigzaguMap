import { PRIMARY_BLOCK_COUNT, unusedTiles, type BlockUsage, type CfruProject } from "@zigzagumap/core";
import { tilesetPairs } from "./blockSwapHost";

/** 使用回数と未使用のタイル（#395。ブロックエディタの 表示 メニュー）。 */
export interface BlockStats {
  /** 一覧の並び（主の 640 個のあとに副）でのブロックの使用回数。表に無い番号は -1。 */
  readonly counts: number[];
  /** 未使用のタイルの通し番号（`tiles` を頼んだときだけ。頼まなければ null）。 */
  readonly unusedTiles: number[] | null;
  /** 数えるのにかかった時間（ミリ秒）。 */
  readonly ms: number;
}

/**
 * メインのウィンドウで、表示中のマップの組（主 `primary`・副 `secondary` のポインタ）のブロックの使用回数を数える
 * （マップタブの「使用回数」と同じ BlockUsage。配置とボーダーを数え、共有している配置は 1 回）。
 * `tiles` なら、同じ主を使う全部の組の副のブロックも読んで、未使用のタイルを数える（読んだタイルセットは捨てる）。
 */
export async function blockStats(project: CfruProject, usage: BlockUsage, primary: number, secondary: number, tiles: boolean): Promise<BlockStats> {
  const t0 = performance.now();
  const ctx = project.editorContext();
  const p = ctx.tileset({ pointer: primary >>> 0, secondary: false });
  const s = ctx.tileset({ pointer: secondary >>> 0, secondary: true });
  const counts = new Array<number>(PRIMARY_BLOCK_COUNT + s.blockCount).fill(-1);
  for (let b = 0; b < p.blockCount; b++) counts[b] = usage.count(b, primary, secondary);
  for (let b = 0; b < s.blockCount; b++) counts[PRIMARY_BLOCK_COUNT + b] = usage.count(PRIMARY_BLOCK_COUNT + b, primary, secondary);
  let unused: number[] | null = null;
  if (tiles) {
    const others = new Set<number>();
    for (const pair of await tilesetPairs(project)) if (pair.primary === primary >>> 0 && pair.secondary !== secondary >>> 0) others.add(pair.secondary);
    const otherBlocks: Uint16Array[] = [];
    for (const pointer of others) {
      try {
        otherBlocks.push((await project.peekTileset({ pointer, secondary: true })).blocks);
      } catch {
        // 読めない副タイルセットは数えない
      }
    }
    unused = unusedTiles({
      primaryBlocks: p.blocks,
      secondaryBlocks: s.blocks,
      otherSecondaryBlocks: otherBlocks,
      primaryTileCount: p.tileCount,
      secondaryTileCount: s.tileCount,
    });
  }
  return { counts, unusedTiles: unused, ms: Math.round(performance.now() - t0) };
}
