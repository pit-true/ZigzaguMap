import { describe, expect, it } from "vitest";
import { gridFromRgba, gridFromRows, overlayGrid, pixelIconSvg } from "../src/ui/pixelIcon";
import { INSERT_MAP_ICON, NEW_MAP_ICON, PIXEL_COLORS, WORLD_MAP_FALLBACK_ICON, worldMapIconFromTownMap } from "../src/ui/toolbarPixelArt";

/** SVG の中の矩形（影を除く、絵の側）を読む。 */
function bodyRects(svg: string): { x: number; y: number; w: number; fill: string }[] {
  const body = svg.slice(svg.lastIndexOf("<g "));
  return [...body.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="2" fill="([^"]+)"\/>/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    fill: m[4]!,
  }));
}

describe("ドット絵のアイコン（#541）", () => {
  it("1 ドットを 2×2 にし、横に続く同じ色は 1 つの矩形にまとめる", () => {
    const svg = pixelIconSvg(gridFromRows(["AAB", ".A."], { A: "#111111", B: "#222222" }), "t");
    expect(bodyRects(svg)).toEqual([
      { x: 0, y: 0, w: 4, fill: "#111111" },
      { x: 4, y: 0, w: 2, fill: "#222222" },
      { x: 2, y: 2, w: 2, fill: "#111111" },
    ]);
    // 32×32 の真ん中（影の 1 画素を残す）に置き、影のフィルターは渡した名前
    expect(svg).toContain('width="32" height="32"');
    expect(svg).toContain('translate(12 13)');
    expect(svg).toContain('filter="url(#px-shadow-t)"');
  });

  it("重ねると上の絵の透明な所だけ下が見える", () => {
    const g = overlayGrid(gridFromRows(["AA", "AA"], { A: "#a" }), gridFromRows(["B."], { B: "#b" }), 1, 1);
    expect([g.at(0, 0), g.at(1, 0), g.at(0, 1), g.at(1, 1)]).toEqual(["#a", "#a", "#a", "#b"]);
  });

  it("RGBA の画素は透明度 0 を透明にし、ほかは #rrggbb", () => {
    const g = gridFromRgba({ width: 2, height: 1, data: [255, 16, 0, 255, 1, 2, 3, 0] });
    expect([g.at(0, 0), g.at(1, 0), g.at(2, 0)]).toEqual(["#ff1000", null, null]);
  });

  it("3 つの絵は 15×15 ドットで、色は表の色だけ（色数を絞る）。新規と挿入は違う絵", () => {
    const colors = new Set(Object.values(PIXEL_COLORS));
    for (const svg of [NEW_MAP_ICON, INSERT_MAP_ICON, WORLD_MAP_FALLBACK_ICON]) {
      const rects = bodyRects(svg);
      expect(Math.max(...rects.map((r) => r.x + r.w))).toBe(30);
      expect(Math.max(...rects.map((r) => r.y)) + 2).toBe(30);
      for (const r of rects) expect(colors.has(r.fill), r.fill).toBe(true);
      expect(new Set(rects.map((r) => r.fill)).size).toBeLessThanOrEqual(16);
    }
    expect(NEW_MAP_ICON).not.toBe(INSERT_MAP_ICON);
  });

  it("切り出した 13×13 の画素に輪郭を付けて 15×15 にする（角は透明）", () => {
    const data = new Uint8ClampedArray(13 * 13 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([0x10, 0x80, 0xf0, 255], i);
    const rects = bodyRects(worldMapIconFromTownMap({ width: 13, height: 13, data }));
    expect(rects[0]).toEqual({ x: 2, y: 0, w: 26, fill: PIXEL_COLORS["K"] });
    expect(rects).toContainEqual({ x: 2, y: 2, w: 26, fill: "#1080f0" });
    expect(rects.at(-1)).toEqual({ x: 2, y: 28, w: 26, fill: PIXEL_COLORS["K"] });
  });
});
