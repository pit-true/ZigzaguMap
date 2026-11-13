import { describe, expect, it } from "vitest";
import { BPRJ_OFFSETS, MapLoader, Rom, renderMap, type RgbaImage } from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

function pixel(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const o = (y * image.width + x) * 4;
  return [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!, image.data[o + 3]!];
}

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];

describe("マップの描画（合成 ROM）", () => {
  const map = new MapLoader(new Rom(buildSyntheticRom()), BPRJ_OFFSETS).load({ bank: 0, map: 0 });
  const image = renderMap(map);

  it("大きさはブロック数×16", () => {
    expect(image.width).toBe(32);
    expect(image.height).toBe(32);
    expect(image.data.length).toBe(32 * 32 * 4);
  });

  it("主タイルセットのブロックをパレットどおりに描く", () => {
    expect(pixel(image, 0, 0)).toEqual(GREEN);
    expect(pixel(image, 1, 0)).toEqual(RED);
    expect(pixel(image, 8, 0)).toEqual(GREEN);
  });

  it("左右反転を反映する", () => {
    // ブロック2 の左上タイルは左右反転なので、色2 は (7,0) に来る。
    expect(pixel(image, 16, 0)).toEqual(RED);
    expect(pixel(image, 16 + 7, 0)).toEqual(GREEN);
  });

  it("副タイルセットの上層と副パレットを使い、色0 は背景色が見える", () => {
    expect(pixel(image, 0, 16)).toEqual(WHITE);
    expect(pixel(image, 15, 31)).toEqual(WHITE);
  });

  it("移動許可はブロックの絵に影響しない", () => {
    expect(pixel(image, 17, 16)).toEqual(RED);
  });

  it("配置を渡すとその配置で描く。定義の無いブロックは背景色", () => {
    const other = renderMap(map, Uint16Array.from([0, 0, 0, 0]));
    expect(pixel(other, 0, 0)).toEqual(BLUE);
  });
});
