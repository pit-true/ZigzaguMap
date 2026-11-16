import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nonTrainerSpottingEnabled, npcSpotter } from "../src/index.js";

const p = (trainerType: number, range = 3) => ({ trainerType, trainerRangeOrBerryTree: range });
const vanilla = { cfru: false, nonTrainerSpotting: false };
const cfru = { cfru: true, nonTrainerSpotting: true };

describe("見つける人物", () => {
  it("元の日本語版は 1 が 1 方向、3 が 4 方向。ほかは見ない", () => {
    expect(npcSpotter(p(1), 0x5c, vanilla)).toEqual({ kind: "trainer", allDirections: false, range: 3 });
    expect(npcSpotter(p(3), 0x5c, vanilla)).toEqual({ kind: "trainer", allDirections: true, range: 3 });
    expect(npcSpotter(p(2), 0x5c, vanilla)).toBeNull();
    expect(npcSpotter(p(0), 0x5c, vanilla)).toBeNull();
    expect(npcSpotter(p(1, 0), 0x5c, vanilla)).toBeNull();
  });

  it("CFRU は 0 以外を全部見て、trainerbattle で始まらなければ普通の人物（設定が有効なときだけ）", () => {
    expect(npcSpotter(p(1), 0x5c, cfru)).toEqual({ kind: "trainer", allDirections: false, range: 3 });
    expect(npcSpotter(p(2), 0x5c, cfru)).toEqual({ kind: "trainer", allDirections: true, range: 3 });
    expect(npcSpotter(p(1), 0x6a, cfru)).toEqual({ kind: "npc", allDirections: false, range: 3 });
    expect(npcSpotter(p(1), 0x6a, { cfru: true, nonTrainerSpotting: false })).toBeNull();
    expect(npcSpotter(p(1), null, cfru)!.kind).toBe("trainer");
  });

  it("config.h の定義はコメントの中を数えない", () => {
    expect(nonTrainerSpottingEnabled("#define NON_TRAINER_SPOTTING //Comment out\n")).toBe(true);
    expect(nonTrainerSpottingEnabled("//#define NON_TRAINER_SPOTTING\n")).toBe(false);
    expect(nonTrainerSpottingEnabled("/* #define NON_TRAINER_SPOTTING */\n")).toBe(false);
    expect(nonTrainerSpottingEnabled(null)).toBe(false);
  });

  const nd = process.env.ZIGZAGU_ND_DIR, chronos = process.env.ZIGZAGU_CHRONOS_DIR;
  it.skipIf(!nd || !chronos)("ND と Chronos の写しはどちらも有効", () => {
    for (const root of [nd!, chronos!]) {
      const file = [`${root}/src/config.h`, `${root}/cfru/src/config.h`].find(f => existsSync(f))!;
      expect(existsSync(file)).toBe(true);
      expect(nonTrainerSpottingEnabled(readFileSync(file, "utf8"))).toBe(true);
    }
  });
});
