import { describe, expect, it } from "vitest";
import { EventSelection, clampGroupDelta, duplicatePosition, eventsInRect } from "../src/ui/event/EventSelection";
import type { PlacedEvent } from "../src/ui/map/EventLayer";

const placed: PlacedEvent[] = [
  { kind: "person", index: 0, x: 1, y: 1 },
  { kind: "person", index: 1, x: 4, y: 1 },
  { kind: "warp", index: 0, x: 2, y: 3 },
  { kind: "sign", index: 0, x: 5, y: 5 },
  { kind: "fly", index: 7, x: 0, y: 0 },
];

describe("イベントの複数選択（#399）", () => {
  it("Shift＋クリックで足すと、今の 1 つと合わせて 2 つになり、外すと 1 つに戻る（中身は空）", () => {
    const s = new EventSelection();
    const primary = { kind: "person" as const, index: 0 };
    expect(s.toggle({ kind: "warp", index: 0 }, primary)).toEqual({ kind: "warp", index: 0 });
    expect(s.multiple).toBe(true);
    expect(s.list()).toEqual([primary, { kind: "warp", index: 0 }]);
    expect(s.toggle({ kind: "warp", index: 0 }, primary)).toEqual(primary);
    expect(s.multiple).toBe(false);
    expect(s.list()).toEqual([]);
  });

  it("フライトポジションは番号に関係なく 1 つ", () => {
    const s = new EventSelection();
    s.set([
      { kind: "fly", index: 0 },
      { kind: "person", index: 1 },
    ]);
    expect(s.has({ kind: "fly", index: 7 })).toBe(true);
    expect(s.placed(placed).map((p) => p.kind)).toEqual(["person", "fly"]);
  });

  it("矩形の中のものを足し、無くなったものは外す", () => {
    const s = new EventSelection();
    const inRect = eventsInRect(placed, { x: 5, y: 5 }, { x: 1, y: 1 });
    expect(inRect).toEqual([
      { kind: "person", index: 0 },
      { kind: "person", index: 1 },
      { kind: "warp", index: 0 },
      { kind: "sign", index: 0 },
    ]);
    expect(s.addAll(inRect, null)).toEqual({ kind: "sign", index: 0 });
    s.prune((r) => r.kind !== "person" || r.index === 0);
    expect(s.list()).toEqual([
      { kind: "person", index: 0 },
      { kind: "warp", index: 0 },
      { kind: "sign", index: 0 },
    ]);
  });
});

describe("まとめて動かす量（#399）", () => {
  const size = { width: 10, height: 8 };
  it("マップの中のものはマップの外へ出さない", () => {
    expect(clampGroupDelta([{ x: 1, y: 1 }, { x: 8, y: 6 }], 5, 5, size)).toEqual({ dx: 1, dy: 1 });
    expect(clampGroupDelta([{ x: 1, y: 1 }, { x: 8, y: 6 }], -5, -5, size)).toEqual({ dx: -1, dy: -1 });
  });
  it("元から外にあるもの（クローン）は 0〜0xFFFF だけを見る", () => {
    expect(clampGroupDelta([{ x: 2, y: 2 }, { x: 12, y: 3 }], 3, 0, size)).toEqual({ dx: 3, dy: 0 });
  });
});

describe("複製を置くマス（#399）", () => {
  const size = { width: 4, height: 4 };
  it("1 マス右下が空いていればそこ", () => {
    expect(duplicatePosition({ x: 1, y: 1 }, size, new Set())).toEqual({ x: 2, y: 2 });
  });
  it("ふさがっていれば近くの空いたマス。置いたマスはふさがる", () => {
    const taken = new Set(["2,2"]);
    const a = duplicatePosition({ x: 1, y: 1 }, size, taken);
    expect(Math.max(Math.abs(a.x - 2), Math.abs(a.y - 2))).toBe(1);
    expect(taken.has(`${a.x},${a.y}`)).toBe(true);
  });
  it("右下の端ならマップの中に収める", () => {
    expect(duplicatePosition({ x: 3, y: 3 }, size, new Set())).toEqual({ x: 3, y: 3 });
  });
});
