import { describe, expect, it } from "vitest";
import { dropTripleChildren, paletteBlock, paletteRectSelection, tripleStatusSuffix, type TripleLookup } from "../src/input/tripleRules";

/** 3 層のブロック（その次が 3 層の次の番号）。 */
function lookup(triples: number[], unresolved: number[] = []): TripleLookup {
  const t = new Set(triples);
  return {
    isTriple: (b) => t.has(b),
    isTripleChild: (b) => t.has(b - 1) && !unresolved.includes(b - 1),
    info: (b) => ({ triple: t.has(b), tripleChild: t.has(b - 1) && !unresolved.includes(b - 1), unresolved: unresolved.includes(b) }),
  };
}

describe("3 層のブロックの選び方（#300）", () => {
  const triple = lookup([0x10]);
  const width = 8;
  const blockAt = (x: number, y: number) => (x < width ? y * width + x : null);

  it("次の番号を押すと 1 つ前の 3 層のブロックを選ぶ", () => {
    expect(paletteBlock(triple, 0x11)).toBe(0x10);
    expect(paletteBlock(triple, 0x10)).toBe(0x10);
    expect(paletteBlock(null, 0x11)).toBe(0x11);
  });

  it("矩形の右端が 3 層なら 1 マス広げ、次の番号は書かないマスにする", () => {
    // 0x10 は (0, 2)。(0,2)〜(0,3) を選ぶと右端が 3 層なので幅 2 になる
    const s = paletteRectSelection({ x: 0, y: 2, w: 1, h: 2 }, blockAt, triple, width);
    expect(s).toEqual({ width: 2, height: 2, blocks: [0x10, 0x11, 0x18, 0x19], holes: [false, true, false, false] });
  });

  it("次の番号が左端に入っても書かないマス。3 層が無ければ穴を持たない", () => {
    const s = paletteRectSelection({ x: 1, y: 2, w: 2, h: 1 }, blockAt, triple, width);
    expect(s).toEqual({ width: 2, height: 1, blocks: [0x11, 0x12], holes: [true, false] });
    expect(paletteRectSelection({ x: 3, y: 0, w: 2, h: 1 }, blockAt, triple, width)).toEqual({ width: 2, height: 1, blocks: [3, 4] });
  });

  it("パレットの右端なら広げない", () => {
    const t = lookup([0x0f]);
    expect(paletteRectSelection({ x: 7, y: 1, w: 1, h: 1 }, blockAt, t, width).width).toBe(1);
  });

  it("ステータスバーに 3 層・描けない 3 層・次の番号を足す", () => {
    const t = lookup([0x10, 0x27f], [0x27f]);
    expect(tripleStatusSuffix(t, 0x10)).toContain("3層");
    expect(tripleStatusSuffix(t, 0x27f)).toContain("次のブロックが無い");
    expect(tripleStatusSuffix(t, 0x11)).toContain("010");
    expect(tripleStatusSuffix(t, 0x12)).toBe("");
  });
});

describe("3 層の次の番号を置かない（#301）", () => {
  it("書くマスから落とし、落とした数を返す", () => {
    const t = lookup([0x10]);
    const list = [
      { x: 0, y: 0, block: 0x10 },
      { x: 1, y: 0, block: 0x11 },
      { x: 2, y: 0, block: 0x12, movement: 1 },
    ];
    expect(dropTripleChildren(list, (b) => t.isTripleChild(b))).toEqual({ kept: [list[0], list[2]], skipped: 1 });
    expect(dropTripleChildren(list, null)).toEqual({ kept: list, skipped: 0 });
  });
});
