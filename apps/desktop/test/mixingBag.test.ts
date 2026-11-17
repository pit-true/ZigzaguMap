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

  it("重みが全部 1 なら重みを付ける前と同じ並び（#515）", () => {
    const bag = new MixingBag();
    bag.set([4, 5, 6], 9);
    const r = seededRandom(9);
    for (let i = 0; i < 40; i++) expect(bag.pick()).toBe([4, 5, 6][Math.floor(r() * 3)]);
  });

  it("重みで選ぶ割合が変わる。重みは 1〜9 に収め、袋から出すと消える（#515）", () => {
    const bag = new MixingBag();
    bag.set([1, 2], 3, [1, 9]);
    expect(bag.weightOf(2)).toBe(9);
    const picks = Array.from({ length: 2000 }, () => bag.pick());
    const twos = picks.filter((b) => b === 2).length / picks.length;
    expect(twos).toBeGreaterThan(0.85);
    expect(twos).toBeLessThan(0.95);
    expect(bag.setWeight(1, 20)).toBe(true);
    expect(bag.weightOf(1)).toBe(9);
    expect(bag.setWeight(1, 9)).toBe(false);
    expect(bag.setWeight(7, 3)).toBe(false);
    bag.toggle(2);
    bag.toggle(2);
    expect(bag.weightOf(2)).toBe(1);
    bag.clear();
    expect(bag.weightOf(1)).toBe(1);
  });
});
