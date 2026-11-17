import { describe, expect, it } from "vitest";
import { ALL_LAYERS, BlockRenderer, LAYER_BOTTOM, LAYER_THIRD, LAYER_TOP, type Tileset } from "../src/index.js";

/**
 * タイル 1: 全画素が色 1、タイル 2: 左半分が色 2（右は色 0 で透ける）、タイル 3: 上半分が色 3（下は透ける）。
 * パレット 0: 色 0 白、1 赤、2 緑、3 青。
 * ブロック 0: 下 = タイル 1、上 = タイル 2。ブロック 1（3 層）: 下 = タイル 1、上 = タイル 2、3 枚目 = ブロック 2 の下（タイル 3）。
 */
function tilesets(): { primary: Tileset; secondary: Tileset } {
  const tiles = new Uint8Array(32 * 4);
  tiles.fill(0x11, 32, 64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 2; x++) tiles[64 + y * 4 + x] = 0x22;
  tiles.fill(0x33, 96, 96 + 16);
  const palettes = new Uint16Array(256);
  palettes[0] = 0x7fff;
  palettes[1] = 0x001f;
  palettes[2] = 0x03e0;
  palettes[3] = 0x7c00;
  const blocks = new Uint16Array(3 * 8);
  for (const b of [0, 1]) {
    blocks.fill(1, b * 8, b * 8 + 4);
    blocks.fill(2, b * 8 + 4, b * 8 + 8);
  }
  blocks.fill(3, 16, 20);
  const attributes = new Uint32Array(3);
  attributes[1] = 3 << 28;
  const header = { offset: 0, isCompressed: false, isSecondary: false, tilesOffset: 0, palettesOffset: 0, blocksOffset: 0, callback: 0, attributesOffset: 0 };
  const primary: Tileset = { header, tiles, palettes, blocks, attributes };
  const secondary: Tileset = { header: { ...header, isSecondary: true }, tiles: new Uint8Array(0), palettes: new Uint16Array(256), blocks: new Uint16Array(0), attributes: new Uint32Array(0) };
  return { primary, secondary };
}

/** (x, y) の色の RGB。 */
function rgb(px: Uint8ClampedArray, x: number, y: number): number[] {
  const o = (y * 16 + x) * 4;
  return [px[o]!, px[o + 1]!, px[o + 2]!];
}

const WHITE = [255, 255, 255];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];

describe("描くレイヤーの選択（#513）", () => {
  const { primary, secondary } = tilesets();

  it("全部のレイヤーは、レイヤーを渡さないときと画素まで同じ", () => {
    const plain = new BlockRenderer(primary, secondary);
    const all = new BlockRenderer(primary, secondary, undefined, ALL_LAYERS);
    for (const b of [0, 1, 2]) expect([...all.render(b)]).toEqual([...plain.render(b)]);
    expect(plain.layers).toBe(ALL_LAYERS);
  });

  it("上を外すと下のレイヤーだけ、下を外すと背景色の上に上のレイヤー", () => {
    const full = new BlockRenderer(primary, secondary).render(0);
    expect(rgb(full, 0, 0)).toEqual(GREEN);
    expect(rgb(full, 5, 0)).toEqual(RED);
    const bottom = new BlockRenderer(primary, secondary, undefined, LAYER_BOTTOM | LAYER_THIRD).render(0);
    expect(rgb(bottom, 0, 0)).toEqual(RED);
    expect(rgb(bottom, 5, 0)).toEqual(RED);
    const top = new BlockRenderer(primary, secondary, undefined, LAYER_TOP | LAYER_THIRD).render(0);
    expect(rgb(top, 0, 0)).toEqual(GREEN);
    expect(rgb(top, 5, 0)).toEqual(WHITE);
  });

  it("3 枚目はトリプルレイヤーのブロックだけに重なり、外せる", () => {
    const full = new BlockRenderer(primary, secondary).render(1);
    expect(rgb(full, 5, 0)).toEqual(BLUE);
    expect(rgb(full, 5, 6)).toEqual(RED);
    const noThird = new BlockRenderer(primary, secondary, undefined, LAYER_BOTTOM | LAYER_TOP).render(1);
    expect(rgb(noThird, 5, 0)).toEqual(RED);
    expect(rgb(noThird, 0, 0)).toEqual(GREEN);
    const onlyThird = new BlockRenderer(primary, secondary, undefined, LAYER_THIRD).render(1);
    expect(rgb(onlyThird, 5, 0)).toEqual(BLUE);
    expect(rgb(onlyThird, 5, 6)).toEqual(WHITE);
  });
});
