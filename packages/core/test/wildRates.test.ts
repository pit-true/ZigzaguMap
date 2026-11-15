import { describe, expect, it } from "vitest";
import { FISHING_SLOT_RATES, LAND_SLOT_RATES, WATER_SLOT_RATES, levelDistribution, rateGroup, searchSpecies, slotRate, speciesTotals, type WildArea } from "../src/index.js";

const sum = (a: Iterable<number>) => [...a].reduce((x, y) => x + y, 0);

describe("野生の枠の割合（#398）", () => {
  it("草むら・水・岩砕きは合計 100%、釣りは竿ごとに 100%", () => {
    expect(sum(LAND_SLOT_RATES)).toBe(100);
    expect(sum(WATER_SLOT_RATES)).toBe(100);
    for (const rod of [0, 1, 2]) expect(sum(FISHING_SLOT_RATES.filter((_, i) => rateGroup(3, i) === rod))).toBe(100);
    expect(slotRate(0, 0)).toBe(20);
    expect(slotRate(2, 0)).toBe(60);
    expect(slotRate(3, 2)).toBe(60);
    expect(slotRate(0, 12)).toBe(0);
  });

  const land: WildArea = {
    rate: 20,
    slots: LAND_SLOT_RATES.map((_, i) => ({ minLevel: 2, maxLevel: i < 2 ? 3 : 2, species: i % 3 === 0 ? 16 : 19 })),
  };
  it("種族ごとの合計とレベルの分布（合計 100%）", () => {
    const t = speciesTotals(0, land);
    // 16 は枠 0・3・6・9 = 20+10+5+4
    expect(t).toEqual([
      { species: 19, rate: 61 },
      { species: 16, rate: 39 },
    ]);
    expect(sum(t.map((x) => x.rate))).toBe(100);
    const lv = levelDistribution(0, land);
    expect(sum(lv.values())).toBeCloseTo(100);
    // 枠 0・1 は Lv2〜3 に半分ずつ
    expect(lv.get(3)).toBeCloseTo(20);
    expect(levelDistribution(0, land, 16).get(3)).toBeCloseTo(10);
  });
  it("釣りは竿を選べる", () => {
    const fish: WildArea = { rate: 5, slots: FISHING_SLOT_RATES.map((_, i) => ({ minLevel: 5, maxLevel: 5, species: i < 2 ? 129 : 118 })) };
    expect(speciesTotals(3, fish, 0)).toEqual([{ species: 129, rate: 100 }]);
    expect(speciesTotals(3, fish, 2)).toEqual([{ species: 118, rate: 100 }]);
  });
  it("種族の全マップ検索", () => {
    const rows = searchSpecies(
      [
        { id: { bank: 3, map: 19 }, wild: { time: 1, areas: [land, { rate: 0, slots: [] }, { rate: 0, slots: [] }, { rate: 0, slots: [] }] } },
        { id: { bank: 1, map: 0 }, wild: null },
      ],
      16,
    );
    expect(rows.map((r) => [r.slot, r.rate])).toEqual([
      [0, 20],
      [3, 10],
      [6, 5],
      [9, 4],
    ]);
    expect(rows[0]!.map).toEqual({ bank: 3, map: 19 });
  });
});
