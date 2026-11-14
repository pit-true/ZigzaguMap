import { describe, expect, it } from "vitest";
import { MixingBag, seededRandom } from "../src/app/MixingBag";

describe("ミキシングバッグ（#236）", () => {
  it("出し入れと、袋を使う選択", () => {
    const bag = new MixingBag();
    expect(bag.toggle(5)).toBe(true);
    expect(bag.appliesTo({ width: 1, height: 1, blocks: [5] })).toBe(false);
    bag.toggle(6);
    expect(bag.appliesTo({ width: 1, height: 1, blocks: [5] })).toBe(true);
    expect(bag.appliesTo({ width: 1, height: 1, blocks: [7] })).toBe(false);
    expect(bag.appliesTo({ width: 1, height: 1, blocks: [5], movements: [0] })).toBe(false);
    expect(bag.appliesTo({ width: 2, height: 1, blocks: [5, 6] })).toBe(false);
    expect(bag.toggle(5)).toBe(false);
    expect(bag.blocks).toEqual([6]);
    bag.clear();
    expect(bag.blocks).toEqual([]);
  });

  it("種を決めると同じ並び。袋の中のものだけを選ぶ", () => {
    const a = new MixingBag();
    const b = new MixingBag();
    a.set([1, 2, 3], 7);
    b.set([1, 2, 3], 7);
    const pa = Array.from({ length: 50 }, () => a.pick());
    const pb = Array.from({ length: 50 }, () => b.pick());
    expect(pa).toEqual(pb);
    expect(new Set(pa)).toEqual(new Set([1, 2, 3]));
    const r = seededRandom(1);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
