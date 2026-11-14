import { describe, expect, it } from "vitest";
import { rectOf, tileRect } from "../src/input/paintPlans";

describe("矩形塗りの計画（Phase3 #233）", () => {
  it("2 点から矩形（どちら向きのドラッグでも同じ）", () => {
    expect(rectOf({ x: 5, y: 1 }, { x: 2, y: 4 })).toEqual({ x: 2, y: 1, width: 4, height: 4 });
  });

  it("1 ブロックで埋める", () => {
    const cells = tileRect({ x: 1, y: 1, width: 2, height: 2 }, { width: 1, height: 1, blocks: [7] });
    expect(cells).toEqual([
      { x: 1, y: 1, block: 7 },
      { x: 2, y: 1, block: 7 },
      { x: 1, y: 2, block: 7 },
      { x: 2, y: 2, block: 7 },
    ]);
  });

  it("スタンプは左上を基準に敷き詰め、端で切る。移動許可も持つ", () => {
    const cells = tileRect({ x: 0, y: 0, width: 3, height: 3 }, { width: 2, height: 2, blocks: [1, 2, 3, 4], movements: [10, 11, 12, 13] });
    expect(cells.map((c) => c.block)).toEqual([1, 2, 1, 3, 4, 3, 1, 2, 1]);
    expect(cells.map((c) => c.movement)).toEqual([10, 11, 10, 12, 13, 12, 10, 11, 10]);
  });
});
