import { describe, expect, it } from "vitest";
import { gridFromRgba, gridFromRows, overlayGrid, pixelIconPixels, type IconPixels } from "../src/ui/pixelIcon";
import { INSERT_MAP_ICON, NEW_MAP_ICON, PIXEL_COLORS, WORLD_MAP_FALLBACK_ICON, worldMapIconFromTownMap } from "../src/ui/toolbarPixelArt";

const px = (p: IconPixels, x: number, y: number): number[] => [...p.data.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
const hex = (p: IconPixels, x: number, y: number): string =>
  "#" + px(p, x, y).slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");

/** 不透明な画素の範囲と色の集まり。 */
function opaque(p: IconPixels): { right: number; bottom: number; colors: Set<string> } {
  let right = 0;
  let bottom = 0;
  const colors = new Set<string>();
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (px(p, x, y)[3] !== 255) continue;
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
      colors.add(hex(p, x, y));
    }
  }
  return { right, bottom, colors };
}

describe("ドット絵のアイコン（#541）", () => {
  it("1 ドットを 2×2 にし、32×32 の真ん中（影の 1 画素を残す）に置く", () => {
    const p = pixelIconPixels(gridFromRows(["AB", ".A"], { A: "#112233", B: "#445566" }));
    // 2×2 ドット → 4×4 画素。左上は (13, 13)
    expect(px(p, 13, 13)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(px(p, 14, 14)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(px(p, 15, 13)).toEqual([0x44, 0x55, 0x66, 255]);
    expect(px(p, 15, 15)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(px(p, 0, 0)[3]).toBe(0);
  });

  it("影は黒で右下へ 1 画素ずらしてぼかす（110/255 を超えず、離れると薄い）", () => {
    const p = pixelIconPixels(gridFromRows(["A"], { A: "#111111" }));
    // 絵は (14, 14) から 2×2。絵の外の (16, 16) は影
    const center = px(p, 16, 16);
    expect(center.slice(0, 3)).toEqual([0, 0, 0]);
    expect(center[3]).toBeGreaterThan(40);
    expect(center[3]).toBeLessThanOrEqual(110);
    expect(px(p, 18, 16)[3]).toBeLessThan(center[3]!);
    expect(px(p, 10, 10)[3]).toBe(0);
  });

  it("重ねると上の絵の透明な所だけ下が見える", () => {
    const g = overlayGrid(gridFromRows(["AA", "AA"], { A: "#aaaaaa" }), gridFromRows(["B."], { B: "#bbbbbb" }), 1, 1);
    expect([g.at(0, 0), g.at(1, 0), g.at(0, 1), g.at(1, 1)]).toEqual(["#aaaaaa", "#aaaaaa", "#aaaaaa", "#bbbbbb"]);
  });

  it("RGBA の画素は透明度 0 を透明にし、ほかは #rrggbb", () => {
    const g = gridFromRgba({ width: 2, height: 1, data: [255, 16, 0, 255, 1, 2, 3, 0] });
    expect([g.at(0, 0), g.at(1, 0), g.at(2, 0)]).toEqual(["#ff1000", null, null]);
  });

  it("3 つの絵は 15×15 ドットで、色は表の色だけ・16 色まで。新規と挿入は違う絵", () => {
    const table = new Set(Object.values(PIXEL_COLORS));
    for (const p of [NEW_MAP_ICON, INSERT_MAP_ICON, WORLD_MAP_FALLBACK_ICON]) {
      const o = opaque(p);
      expect([o.right, o.bottom]).toEqual([30, 30]);
      for (const c of o.colors) expect(table.has(c), c).toBe(true);
      expect(o.colors.size).toBeLessThanOrEqual(16);
    }
    expect(NEW_MAP_ICON.data).not.toEqual(INSERT_MAP_ICON.data);
  });

  it("切り出した 13×13 の画素に輪郭を付けて 15×15 にする（角は透明）", () => {
    const data = new Uint8ClampedArray(13 * 13 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([0x10, 0x80, 0xf0, 255], i);
    const p = worldMapIconFromTownMap({ width: 13, height: 13, data });
    expect(hex(p, 2, 0)).toBe(PIXEL_COLORS["K"]);
    expect(hex(p, 0, 2)).toBe(PIXEL_COLORS["K"]);
    expect(px(p, 0, 0)[3]).toBe(0);
    expect(hex(p, 2, 2)).toBe("#1080f0");
    expect(hex(p, 27, 27)).toBe("#1080f0");
    expect(hex(p, 28, 20)).toBe(PIXEL_COLORS["K"]);
    expect(px(p, 28, 28)[3]).toBeLessThan(255);
  });
});
