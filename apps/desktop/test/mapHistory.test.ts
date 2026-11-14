import { describe, expect, it } from "vitest";
import { MapHistory } from "../src/app/MapHistory";
import { findMaps, labelMatches, normalizeForFind } from "../src/app/mapFind";

const id = (bank: number, map: number) => ({ bank, map });

describe("マップの履歴（#237）", () => {
  it("3 枚開いて 2 回戻ると最初のマップ、進むで戻る", () => {
    const h = new MapHistory();
    h.visit(null, id(3, 0));
    h.visit(id(3, 0), id(3, 1));
    h.visit(id(3, 1), id(4, 1));
    expect(h.back(id(4, 1))).toEqual(id(3, 1));
    expect(h.back(id(3, 1))).toEqual(id(3, 0));
    expect(h.back(id(3, 0))).toBeNull();
    expect(h.forward(id(3, 0))).toEqual(id(3, 1));
    expect(h.forward(id(3, 1))).toEqual(id(4, 1));
    expect(h.forward(id(4, 1))).toBeNull();
  });
  it("戻ってから別のマップを開くと進むは消える", () => {
    const h = new MapHistory();
    h.visit(id(3, 0), id(3, 1));
    h.back(id(3, 1));
    h.visit(id(3, 0), id(5, 0));
    expect(h.canForward).toBe(false);
    expect(h.snapshot()).toEqual({ back: [id(3, 0)], forward: [] });
  });
  it("上限を超えたら古いものから捨てる。開けないマップは飛ばす", () => {
    const h = new MapHistory(3);
    for (let i = 0; i < 5; i++) h.visit(id(1, i), id(1, i + 1));
    expect(h.snapshot().back).toEqual([id(1, 2), id(1, 3), id(1, 4)]);
    expect(h.back(id(1, 5), (m) => m.map !== 4)).toEqual(id(1, 3));
  });
  it("開けなかったら戻す", () => {
    const h = new MapHistory();
    h.visit(id(3, 0), id(3, 1));
    const t = h.back(id(3, 1))!;
    h.undoStep("back", t, id(3, 1));
    expect(h.snapshot()).toEqual({ back: [id(3, 0)], forward: [] });
  });
});

describe("マップ名で探す", () => {
  const maps = [
    { id: id(3, 0), name: "マサラタウン" },
    { id: id(3, 1), name: "トキワシティ" },
    { id: id(5, 4), name: "トキワシティ ポケセン" },
    { id: id(13, 0), name: null },
  ];
  it("名前の部分一致（カタカナとひらがな、全角を区別しない）と番号", () => {
    expect(findMaps(maps, "ときわ").map((c) => c.text)).toEqual(["3.1 トキワシティ", "5.4 トキワシティ ポケセン"]);
    expect(findMaps(maps, "ポケセン").map((c) => c.text)).toEqual(["5.4 トキワシティ ポケセン"]);
    expect(findMaps(maps, "３．０").map((c) => c.text)).toEqual(["3.0 マサラタウン", "13.0"]);
    expect(findMaps(maps, "13").map((c) => c.text)).toEqual(["13.0"]);
    expect(findMaps(maps, "")).toEqual([]);
    expect(normalizeForFind("トキワ シティ")).toBe("ときわしてぃ");
    expect(findMaps(maps, "ときわ ぽけせん").map((c) => c.text)).toEqual(["5.4 トキワシティ ポケセン"]);
  });
  it("一覧の文の絞り込み", () => {
    expect(labelMatches("トキワシティ ポケセン (5.4)", "ぽけせん")).toBe(true);
    expect(labelMatches("マサラタウン (3.0)", "5.4")).toBe(false);
  });
});
