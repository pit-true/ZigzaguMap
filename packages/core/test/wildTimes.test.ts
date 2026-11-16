import { describe, expect, it } from "vitest";
import { WILD_TIMES, usedWildTime, type WildEncounters } from "../src/index.js";

const table = (time: number, filled = true): WildEncounters => ({
  time,
  areas: [{ rate: 20, slots: filled ? [{ minLevel: 2, maxLevel: 3, species: 16 }] : [] }, { rate: 0, slots: [] }, { rate: 0, slots: [] }, { rate: 0, slots: [] }],
});

describe("時間帯の野生（Phase6 #436）", () => {
  it("タブの並びは朝・昼・夕・夜（Wild[].Time の 0〜3）", () => {
    expect(WILD_TIMES).toEqual([0, 1, 2, 3]);
  });

  it("実機で使われる表: その時間帯の表があればそれ、無ければ昼、昼も無ければ null", () => {
    const wild = [table(1), table(3)];
    expect(usedWildTime(wild, 3)).toBe(3);
    expect(usedWildTime(wild, 0)).toBe(1);
    expect(usedWildTime(wild, 2)).toBe(1);
    expect(usedWildTime([table(3)], 0)).toBeNull();
    // データの無い（エリアが全部空の）表は無いのと同じ
    expect(usedWildTime([table(1), table(0, false)], 0)).toBe(1);
  });
});
