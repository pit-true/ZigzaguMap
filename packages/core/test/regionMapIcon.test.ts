import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BPRJ_REGION_MAP, REGION_ICON_SIZE, RegionMapGraphics, Rom, readRegionMapIcon, regionIconArea } from "../src/index.js";

/** 実 ROM のパス。設定されていなければ実 ROM のテストは飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;

/** 作り物の絵（タイルごとに違う色の番号、パレットは番号そのまま）。 */
function sampleGraphics(): RegionMapGraphics {
  const palette = Array.from({ length: 80 }, (_, i) => i * 0x421);
  const tiles: number[] = [];
  for (let t = 0; t < 4; t++) for (let i = 0; i < 32; i++) tiles.push(((i + t) & 15) | (((i * 3 + t) & 15) << 4));
  const screen = Array.from({ length: 600 }, (_, i) => (i % 4) | ((i % 3) << 10) | ((i % 5) << 12));
  return new RegionMapGraphics({ palette, tiles, screens: [screen, screen, screen, screen] });
}

describe("タウンマップのアイコンの切り出し（#541）", () => {
  it("一部を描いた絵は、全体の絵の同じ所と画素が同じ（反転・パレットを含む）", () => {
    const g = sampleGraphics();
    const all = g.render(0);
    const part = g.renderArea(0, 59, 120, REGION_ICON_SIZE, REGION_ICON_SIZE);
    for (let y = 0; y < REGION_ICON_SIZE; y++) {
      for (let x = 0; x < REGION_ICON_SIZE; x++) {
        const a = ((120 + y) * 240 + 59 + x) * 4;
        const b = (y * REGION_ICON_SIZE + x) * 4;
        expect([...part.data.slice(b, b + 4)]).toEqual([...all.data.slice(a, a + 4)]);
      }
    }
  });

  it("絵の外は透明のまま", () => {
    const part = sampleGraphics().renderArea(0, 235, 155, 10, 10);
    expect(part.data[(9 * 10 + 9) * 4 + 3]).toBe(0);
    expect(part.data[3]).toBe(255);
  });

  it("切り出す範囲はマサラタウンのマスの左上から左へ 11 画素・上へ 11 画素。表の外のマスは FR の位置、絵の端では内側に寄せる", () => {
    expect(regionIconArea({ x: 4, y: 11 })).toEqual({ left: 53, top: 109, size: 30 });
    expect(regionIconArea({ x: -1, y: 99 })).toEqual({ left: 53, top: 109, size: 30 });
    expect(regionIconArea({ x: 21, y: 14 })).toEqual({ left: 189, top: 130, size: 30 });
    expect(regionIconArea({ x: 0, y: 0 })).toEqual({ left: 21, top: 21, size: 30 });
  });

  it("対応していないゲームと読めない ROM は null", () => {
    expect(readRegionMapIcon(new Rom(new Uint8Array(0x100)), "BPEJ")).toBeNull();
    expect(readRegionMapIcon(new Rom(new Uint8Array(0x100)), "BPRJ")).toBeNull();
  });

  it.skipIf(!romPath)("実 ROM（ZIGZAGU_TEST_ROM）: 全体の絵の同じ所と同じで、マサラタウンの印（赤）が入る", () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const icon = readRegionMapIcon(rom, "BPRJ")!;
    expect(icon.width).toBe(REGION_ICON_SIZE);
    const all = RegionMapGraphics.read(rom, BPRJ_REGION_MAP).graphics.render(0);
    for (let y = 0; y < REGION_ICON_SIZE; y++) {
      for (let x = 0; x < REGION_ICON_SIZE; x++) {
        const a = ((109 + y) * 240 + 53 + x) * 4;
        const b = (y * REGION_ICON_SIZE + x) * 4;
        expect([...icon.data.slice(b, b + 4)]).toEqual([...all.data.slice(a, a + 4)]);
      }
    }
    let red = 0;
    for (let i = 0; i < icon.data.length; i += 4) if (icon.data[i]! > 200 && icon.data[i + 1]! < 120 && icon.data[i + 2]! < 100) red++;
    expect(red).toBeGreaterThan(4);
  });
});
