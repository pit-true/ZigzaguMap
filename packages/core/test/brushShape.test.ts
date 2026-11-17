import { describe, expect, it } from "vitest";
import { brushShapeCells, brushOffsets, brushStart, clampBrushSize, pickWeighted, toBrushShape } from "../src/index.js";

/** ずれの一覧を、行ごとの文字の絵にする（# が描くマス）。 */
function picture(size: number, shape: "square" | "circle"): string[] {
  const s = brushStart(size);
  const set = new Set(brushOffsets(size, shape).map((o) => `${o.dx},${o.dy}`));
  const rows: string[] = [];
  for (let dy = s; dy < s + size; dy++) {
    let row = "";
    for (let dx = s; dx < s + size; dx++) row += set.has(`${dx},${dy}`) ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

describe("brushShape", () => {
  it("大きさ 1 はカーソルのマスだけ（形に関係なく）", () => {
    expect(brushOffsets(1, "square")).toEqual([{ dx: 0, dy: 0 }]);
    expect(brushOffsets(1, "circle")).toEqual([{ dx: 0, dy: 0 }]);
  });

  it("正方形は N×N で、奇数はカーソルが真ん中、偶数は左上へ寄せる", () => {
    expect(brushOffsets(3, "square")).toHaveLength(9);
    expect(brushShapeCells(10, 5, 3, "square")[0]).toEqual({ x: 9, y: 4 });
    expect(brushShapeCells(10, 5, 3, "square")[8]).toEqual({ x: 11, y: 6 });
    // 大きさ 2: カーソルのマスとその左・上・左上
    expect(brushShapeCells(10, 5, 2, "square")).toEqual([
      { x: 9, y: 4 },
      { x: 10, y: 4 },
      { x: 9, y: 5 },
      { x: 10, y: 5 },
    ]);
    expect(brushStart(4)).toBe(-2);
    expect(brushOffsets(9, "square")).toHaveLength(81);
  });

  it("円は角を落とす（3 で十字、5 と 9 は丸い形）", () => {
    expect(picture(3, "circle")).toEqual([".#.", "###", ".#."]);
    expect(picture(2, "circle")).toEqual(["##", "##"]);
    expect(picture(4, "circle")).toEqual([".##.", "####", "####", ".##."]);
    expect(picture(5, "circle")).toEqual([".###.", "#####", "#####", "#####", ".###."]);
    const nine = picture(9, "circle");
    expect(nine[0]).toBe("...###...");
    expect(nine[4]).toBe("#########");
    // 上下・左右に対称
    expect([...nine].reverse()).toEqual(nine);
    expect(nine.map((r) => [...r].reverse().join(""))).toEqual(nine);
  });

  it("大きさと形の値を確かめて直す", () => {
    expect(clampBrushSize(0)).toBe(1);
    expect(clampBrushSize(12)).toBe(9);
    expect(clampBrushSize(3.4)).toBe(3);
    expect(clampBrushSize("5")).toBe(1);
    expect(toBrushShape("circle")).toBe("circle");
    expect(toBrushShape("diamond")).toBe("square");
  });
});

describe("pickWeighted", () => {
  it("重みが全部 1 なら Math.floor(r * 数) と同じ", () => {
    for (const r of [0, 0.1, 0.33, 0.5, 0.74, 0.999]) expect(pickWeighted([1, 1, 1, 1], r)).toBe(Math.floor(r * 4));
  });

  it("重みの割合で選ぶ（決まった乱数で数える）", () => {
    let a = 12345;
    const random = (): number => {
      // 線形合同法（テストで同じ並びにする）
      a = (Math.imul(a, 1103515245) + 12345) >>> 0;
      return a / 4294967296;
    };
    const counts = [0, 0, 0];
    for (let i = 0; i < 9000; i++) counts[pickWeighted([1, 3, 5], random())]!++;
    expect(counts[0]! / 9000).toBeCloseTo(1 / 9, 1);
    expect(counts[1]! / 9000).toBeCloseTo(3 / 9, 1);
    expect(counts[2]! / 9000).toBeCloseTo(5 / 9, 1);
    expect(counts[2]!).toBeGreaterThan(counts[1]!);
    expect(counts[1]!).toBeGreaterThan(counts[0]!);
  });

  it("境目と、読めない重み・空", () => {
    expect(pickWeighted([1, 3], 0.24)).toBe(0);
    expect(pickWeighted([1, 3], 0.25)).toBe(1);
    expect(pickWeighted([0, Number.NaN, 2], 0.3)).toBe(1);
    expect(pickWeighted([], 0.5)).toBe(-1);
  });
});
