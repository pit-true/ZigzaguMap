import { describe, expect, it } from "vitest";
import { searchSpecies, WILD_TIMES, usedWildTime, type WildEncounters } from "../src/index.js";

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


it("全マップ検索は夜だけの種族を見つけ、時間帯でも絞れる", () => {
  const maps = [{ id: { bank: 3, map: 19 }, wild: [table(1), { ...table(3), areas: [{ rate: 20, slots: [{ minLevel: 5, maxLevel: 7, species: 25 }] }, { rate: 0, slots: [] }, { rate: 0, slots: [] }, { rate: 0, slots: [] }] as WildEncounters["areas"] }] }];
  expect(searchSpecies(maps, 25).map((r) => [r.time, r.minLevel, r.maxLevel])).toEqual([[3, 5, 7]]);
  expect(searchSpecies(maps, 25, 1)).toEqual([]);
  expect(searchSpecies(maps, 25, 3)).toHaveLength(1);
});
