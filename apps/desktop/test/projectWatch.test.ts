import { describe, expect, it } from "vitest";
import { changedMapsOf, diffStamps, isBankDir, isWatchedMapFile, noChanges } from "../src/app/projectWatch";

describe("ファイルの変化の監視（#404）", () => {
  it("変わった・増えた・消えたを分ける", () => {
    const before = new Map([
      ["maps/03/00.json", "1:10"],
      ["maps/03/01.json", "1:10"],
      ["zigzagumap.json", "1:5"],
    ]);
    const after = new Map([
      ["maps/03/00.json", "2:11"],
      ["maps/03/02.json", "2:10"],
      ["zigzagumap.json", "1:5"],
    ]);
    const c = diffStamps(before, after);
    expect(c).toEqual({ changed: ["maps/03/00.json"], added: ["maps/03/02.json"], removed: ["maps/03/01.json"] });
    expect(noChanges(c)).toBe(false);
    expect(noChanges(diffStamps(before, before))).toBe(true);
    expect(changedMapsOf(c)).toEqual([
      { bank: 3, map: 0 },
      { bank: 3, map: 1 },
      { bank: 3, map: 2 },
    ]);
  });

  it("スクリプトの JSON もそのマップ", () => {
    expect(changedMapsOf({ changed: ["maps/05/scripts_12.json", "maps/tilesets/a/tiles.png"], added: [], removed: [] })).toEqual([{ bank: 5, map: 12 }]);
  });

  it("見る名前", () => {
    expect(isBankDir("03")).toBe(true);
    expect(isBankDir("tilesets")).toBe(false);
    expect(isWatchedMapFile("00.json")).toBe(true);
    expect(isWatchedMapFile("scripts_00.json")).toBe(true);
    expect(isWatchedMapFile("00.json.bak")).toBe(false);
    expect(isWatchedMapFile("rom_erase.json")).toBe(false);
  });
});
