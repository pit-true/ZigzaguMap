import { describe, expect, it } from "vitest";
import { EXPORT_PAD, compositeScale, exportCrop, layoutComposite, rectsOverlap, type CompositeSource, type MapConnection } from "../src/index.js";

const conn = (direction: number, offset: number, bank: number, map: number): MapConnection => ({ direction, offset, bank, map, padding: 0 });

describe("layoutComposite（#246）", () => {
  it("上下左右の接続をたどって並べる。ダイブ・浮上はたどらない。輪になっても 1 回だけ", async () => {
    const maps: Record<string, CompositeSource> = {
      "3.0": { width: 24, height: 20, connections: [conn(2, 0, 3, 19), conn(1, -2, 3, 39), conn(5, 0, 3, 50)] },
      "3.19": { width: 24, height: 40, connections: [conn(1, 0, 3, 0), conn(2, 4, 3, 1)] },
      "3.39": { width: 20, height: 30, connections: [conn(2, 2, 3, 0), conn(4, 5, 3, 1)] },
      "3.1": { width: 30, height: 10, connections: [] },
      "3.50": { width: 24, height: 20, connections: [] },
    };
    const r = await layoutComposite({ bank: 3, map: 0 }, async (id) => maps[`${id.bank}.${id.map}`] ?? null);
    expect(r.maps.map((m) => [`${m.id.bank}.${m.id.map}`, m.x, m.y])).toEqual([
      ["3.0", 0, 0],
      ["3.19", 0, -40],
      ["3.39", -2, 20],
      ["3.1", 4, -50],
    ]);
    expect(r.bounds).toEqual({ x: -2, y: -50, width: 36, height: 100 });
  });

  it("読めない開始のマップは空。縮め方", async () => {
    expect((await layoutComposite({ bank: 9, map: 9 }, async () => null)).maps).toEqual([]);
    expect(compositeScale({ x: 0, y: 0, width: 100, height: 50 }, 16)).toBe(1);
    expect(compositeScale({ x: 0, y: 0, width: 1100, height: 50 }, 16)).toBe(2);
    expect(compositeScale({ x: 0, y: 0, width: 3000, height: 50 }, 16)).toBe(4);
  });
});

describe("書き出しの範囲（#403）", () => {
  const layout = {
    maps: [
      { id: { bank: 3, map: 0 }, x: 0, y: 0, width: 20, height: 10 },
      { id: { bank: 3, map: 1 }, x: 0, y: -15, width: 20, height: 15 },
    ],
    bounds: { x: 0, y: -15, width: 20, height: 25 },
  };
  it("このマップ・全マップ・周りの帯", () => {
    expect(exportCrop(layout, false, null)).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(exportCrop(layout, true, null)).toEqual(layout.bounds);
    expect(exportCrop(layout, false, EXPORT_PAD)).toEqual({ x: -7, y: -5, width: 34, height: 20 });
  });
  it("重なり", () => {
    const crop = exportCrop(layout, false, EXPORT_PAD);
    expect(rectsOverlap(crop, layout.maps[1]!)).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, width: 20, height: 10 }, layout.maps[1]!)).toBe(false);
  });
});
