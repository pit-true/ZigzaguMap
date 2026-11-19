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
  it("2 倍のときは 1 ドットを 2×2 にし、32×32 の真ん中（影の 1 画素を残す）に置く", () => {
    const p = pixelIconPixels(gridFromRows(["AB", ".A"], { A: "#112233", B: "#445566" }), { scale: 2, shadow: true });
    // 2×2 ドット → 4×4 画素。左上は (13, 13)
    expect(px(p, 13, 13)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(px(p, 14, 14)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(px(p, 15, 13)).toEqual([0x44, 0x55, 0x66, 255]);
    expect(px(p, 15, 15)).toEqual([0x11, 0x22, 0x33, 255]);
    expect(px(p, 0, 0)[3]).toBe(0);
  });

  it("影は黒で右下へ 1 画素ずらしてぼかす（110/255 を超えず、離れると薄い）", () => {
    const p = pixelIconPixels(gridFromRows(["A"], { A: "#111111" }), { scale: 2, shadow: true });
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

  it("影を付けないときは影の画素が無い（1 倍、32×32 はそのまま）", () => {
    const p = pixelIconPixels(gridFromRows(["A".repeat(32), ...Array.from({ length: 31 }, () => ".".repeat(32))], { A: "#123456" }));
    expect(px(p, 0, 0)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(px(p, 31, 0)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(px(p, 5, 1)[3]).toBe(0);
  });

  it("新規と挿入は 32×32 で影も黒い縁取りも無い（左上は透明）。色は表の色だけ。新規と挿入は違う絵", () => {
    const table = new Set(Object.values(PIXEL_COLORS));
    for (const p of [NEW_MAP_ICON, INSERT_MAP_ICON]) {
      const o = opaque(p);
      expect([o.right, o.bottom]).toEqual([32, 32]);
      for (const c of o.colors) expect(table.has(c), c).toBe(true);
      // 半透明の画素（影）が無い
      for (let i = 3; i < p.data.length; i += 4) expect([0, 255]).toContain(p.data[i]);
      // 下の行は草地
      expect(hex(p, 4, 31)).toBe(PIXEL_COLORS["G"]);
    }
    expect(hex(NEW_MAP_ICON, 14, 20)).toBe(PIXEL_COLORS["W"]);
    expect(NEW_MAP_ICON.data).not.toEqual(INSERT_MAP_ICON.data);
  });

  it("ROM が無いときのワールドマップは 30×30 に影（黒い縁取りは無い）", () => {
    const o = opaque(WORLD_MAP_FALLBACK_ICON);
    expect(o.right).toBeLessThanOrEqual(30);
    expect(o.colors.has("#000000")).toBe(false);
    expect(o.colors.has(PIXEL_COLORS["E"]!)).toBe(true);
  });

  it("切り出した 30×30 は、丸の中の陸だけを残し、丸で切った所と海の際に海岸の色を付ける", () => {
    const data = new Uint8ClampedArray(30 * 30 * 4);
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        // 左半分は陸（緑）、右半分は海（青）
        data.set(x < 15 ? [57, 172, 8, 255] : [164, 180, 255, 255], (y * 30 + x) * 4);
      }
    }
    const p = worldMapIconFromTownMap({ width: 30, height: 30, data });
    expect(hex(p, 8, 15)).toBe("#39ac08");
    expect(hex(p, 14, 15)).toBe("#188308");
    expect(px(p, 20, 15)[3]).toBeLessThan(255);
    expect(px(p, 0, 0)[3]).toBe(0);
    expect(hex(p, 3, 15)).toBe("#188308");
    expect(px(p, 2, 15)[3]).toBeLessThan(255);
  });
});
