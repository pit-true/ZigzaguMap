import { describe, expect, it } from "vitest";
import { unusedTiles } from "../src/index.js";

const blocks = (...refs: number[]) => Uint16Array.from(refs);

describe("未使用のタイル（#395）", () => {
  it("主のタイルは主と全部の組の副のブロックから、副のタイルは今の副と主のブロックから数える", () => {
    const r = unusedTiles({
      primaryBlocks: blocks(0, 1, 0x281 | 0x400),
      secondaryBlocks: blocks(0x280, 2 | 0x3000),
      // ほかの副は主のタイル 3 を使う。副のタイル 0x283 はその副のものなので今の副では使われていない
      otherSecondaryBlocks: [blocks(3, 0x283)],
      primaryTileCount: 5,
      secondaryTileCount: 4,
    });
    expect(r).toEqual([4, 0x282, 0x283]);
  });
  it("反転とパレットのビットは見ない。数の外のタイルは出さない", () => {
    const r = unusedTiles({ primaryBlocks: blocks(0x0c01), secondaryBlocks: blocks(), otherSecondaryBlocks: [], primaryTileCount: 2, secondaryTileCount: 0 });
    expect(r).toEqual([0]);
  });
});
