import { describe, expect, it } from "vitest";
import { analyzeParts, type AnalyzeLayout } from "../src/index.js";

/** 文字の格子からマップを作る（`.` は地面 1、`5` は水 0x50、7 8 9 4 6 1 2 3 は縁、`g` は草むら 2、`T` は木の 2×2 の模様）。 */
function layout(rows: string[]): AnalyzeLayout {
  const map: Record<string, number> = { ".": 1, "5": 0x50, "7": 0x47, "8": 0x48, "9": 0x49, "4": 0x44, "6": 0x46, "1": 0x41, "2": 0x42, "3": 0x43, g: 2 };
  const h = rows.length;
  const w = rows[0]!.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      if (ch === "T") cells[y * w + x] = (0x60 + (x % 2) + (y % 2) * 2) | (1 << 10);
      else cells[y * w + x] = map[ch]!;
    }),
  );
  return { width: w, height: h, cells };
}

describe("マップから候補を作る（#313）", () => {
  it("池の縁・草むら・森を候補に出す", () => {
    const l = layout([
      "..........TTTT",
      ".7889.....TTTT",
      ".4556.ggg.TTTT",
      ".4556.ggg.TTTT",
      ".1223.ggg.TTTT",
      "..........TTTT",
    ]);
    const parts = analyzeParts({ layouts: [l, l, l, l], behavior: (b) => (b === 0x50 ? 0x10 : b === 2 ? 0x02 : 0) });
    const names = parts.map((p) => p.name);
    expect(names.every((n) => n.startsWith("自動: "))).toBe(true);
    const pond = parts.find((p) => p.kind === "edge")!;
    expect(pond.slots["C"]!.cells[0]!.block).toBe(0x50);
    expect(Object.fromEntries(["NW", "N", "NE", "W", "E", "SW", "S", "SE"].map((s) => [s, pond.slots[s]!.cells[0]!.block]))).toEqual({
      NW: 0x47,
      N: 0x48,
      NE: 0x49,
      W: 0x44,
      E: 0x46,
      SW: 0x41,
      S: 0x42,
      SE: 0x43,
    });
    expect(parts.find((p) => p.role === "grass")!.slots["Blocks"]!.cells[0]!.block).toBe(2);
    const forest = parts.find((p) => p.kind === "repeat" && p.role === "tree")!;
    expect(new Set(forest.slots["Body"]!.cells.map((c) => c!.block))).toEqual(new Set([0x60, 0x61, 0x62, 0x63]));
  });
});
