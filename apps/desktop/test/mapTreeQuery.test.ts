import { describe, expect, it } from "vitest";
import { hasSpecialTerms, matchesSpecialTerms, parseMapTreeQuery, regionQuery } from "../src/app/mapTreeQuery";

describe("マップ一覧の絞り込みの書式（#305）", () => {
  it("場所と地形は 16 進、複数可。残りは名前の語", () => {
    const q = parseMapTreeQuery("場所:58,7E  ときわ 地形:0x9");
    expect(q.regions).toEqual([0x58, 0x7e]);
    expect(q.layouts).toEqual([9]);
    expect(q.text).toBe("ときわ");
    expect(hasSpecialTerms(q)).toBe(true);
  });

  it("全角のコロンと読点も使える", () => {
    expect(parseMapTreeQuery("場所：58、59").regions).toEqual([0x58, 0x59]);
  });

  it("読めない値の語はふつうの語として扱う", () => {
    const q = parseMapTreeQuery("場所:xyz マサラ");
    expect(q.regions).toBeNull();
    expect(q.text).toBe("場所:xyz マサラ");
    expect(hasSpecialTerms(q)).toBe(false);
  });

  it("どの語にも合うマップだけ", () => {
    const q = parseMapTreeQuery("場所:58 地形:1");
    expect(matchesSpecialTerms({ region: 0x58, layoutId: 1 }, q)).toBe(true);
    expect(matchesSpecialTerms({ region: 0x58, layoutId: 2 }, q)).toBe(false);
    expect(matchesSpecialTerms({ region: 0x59, layoutId: 1 }, q)).toBe(false);
    expect(matchesSpecialTerms({ region: 0x59, layoutId: 1 }, parseMapTreeQuery("マサラ"))).toBe(true);
  });

  it("タウンマップの小窓から絞るときの語", () => {
    expect(regionQuery(0x58)).toBe("場所:58");
    expect(regionQuery(5)).toBe("場所:05");
  });
});
