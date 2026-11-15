import { describe, expect, it } from "vitest";
import { timelapsePositions } from "../src/app/Timelapse";

const paint = (bank: number, map: number) => ({ name: "paintBlocks", args: { bank, map, cells: [] } });

describe("タイムラプスのコマの位置（#403）", () => {
  const history = [paint(3, 0), paint(3, 1), paint(3, 0), paint(3, 0), paint(3, 0)];

  it("このマップを変えた操作の後と、最初の変更の前", () => {
    expect(timelapsePositions(history, { bank: 3, map: 0 }, 0)).toEqual([0, 1, 3, 4, 5]);
    expect(timelapsePositions(history, { bank: 3, map: 1 }, 0)).toEqual([1, 2]);
  });

  it("とばしても最後（今の状態）は入れる", () => {
    expect(timelapsePositions(history, { bank: 3, map: 0 }, 1)).toEqual([0, 3, 5]);
    expect(timelapsePositions(history, { bank: 3, map: 0 }, 2)).toEqual([0, 4, 5]);
  });

  it("変更が無ければ空", () => {
    expect(timelapsePositions(history, { bank: 4, map: 0 }, 0)).toEqual([]);
  });
});
