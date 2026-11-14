import { describe, expect, it } from "vitest";
import {
  BlockRenderer,
  TripleLayerIndex,
  isTripleLayer,
  layerMode,
  unpackBlockAttribute,
  type Tileset,
} from "../src/index.js";

// 色（BGR555）: パレット 0 の 0 番は背景、1 番が赤、2 番が緑、3 番が青。
const PAL = [0x7fff, 0x001f, 0x03e0, 0x7c00];
const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];

/** タイル 4 枚: 0 は全部色 0、1 は全部色 1、2 は左上 1 画素だけ色 2、3 は右下 1 画素だけ色 3。 */
function tiles(): Uint8Array {
  const t = new Uint8Array(32 * 4);
  t.fill(0x11, 32, 64);
  t[64] = 0x02;
  t[96 + 31] = 0x30;
  return t;
}

function tileset(blockCount: number, secondary: boolean): Tileset & { blocks: Uint16Array; attributes: Uint32Array } {
  const palettes = new Uint16Array(256);
  for (let p = 0; p < 16; p++) palettes.set(PAL, p * 16);
  return {
    header: { offset: 0, isCompressed: false, isSecondary: secondary, tilesOffset: 0, palettesOffset: 0, blocksOffset: 0, callback: 0, attributesOffset: 0 },
    tiles: secondary ? new Uint8Array(0) : tiles(),
    palettes,
    blocks: new Uint16Array(blockCount * 8),
    attributes: new Uint32Array(blockCount),
  };
}

function px(image: Uint8ClampedArray, x: number, y: number): number[] {
  const o = (y * 16 + x) * 4;
  return [...image.subarray(o, o + 4)];
}

describe("トリプルレイヤーの判定", () => {
  it("ビット 28〜30 が 3 なら 3 層（ビット 26・27・31 は見ない）", () => {
    expect(layerMode(0x30000000)).toBe(3);
    expect(isTripleLayer(0x30000000)).toBe(true);
    expect(isTripleLayer(0x34000000)).toBe(true);
    expect(isTripleLayer(0xbc000000)).toBe(true);
    expect(isTripleLayer(0x20000000)).toBe(false);
    expect(isTripleLayer(0x70000000)).toBe(false);
    expect(layerMode(0xf0000000)).toBe(7);
  });

  it("layerType（AdvanceMap と同じビット 29〜30）の意味は変えない", () => {
    expect(unpackBlockAttribute(0x30000000).layerType).toBe(1);
  });

  it("次の番号・表の外・3 層の次の番号を引ける", () => {
    const p = tileset(640, false);
    const s = tileset(10, true);
    p.attributes[5] = 0x30000000;
    p.attributes[639] = 0x30000000;
    s.attributes[3] = 0x30000000;
    s.attributes[9] = 0x30000000;
    s.attributes[7] = 0x50000000;
    const index = new TripleLayerIndex(p, s);
    expect(index.thirdOf(5)).toBe(6);
    expect(index.isTripleChild(6)).toBe(true);
    expect(index.parentOf(6)).toBe(5);
    expect(index.isTripleChild(5)).toBe(false);
    // 主の 639 番の次は副の 640 番ではない
    expect(index.thirdOf(639)).toBeNull();
    expect(index.info(639)).toMatchObject({ triple: true, unresolved: true });
    expect(index.isTripleChild(640)).toBe(false);
    expect(index.thirdOf(643)).toBe(644);
    expect(index.isTripleChild(644)).toBe(true);
    expect(index.info(649)).toMatchObject({ triple: true, unresolved: true, tripleChild: false });
    expect(index.isLastOfTable(649)).toBe(true);
    expect(index.info(647)).toMatchObject({ layerMode: 5, undrawn: true, triple: false });
    expect(index.info(2000)).toMatchObject({ triple: false, tripleChild: false });
  });
});

describe("トリプルレイヤーの描画", () => {
  function build(): { p: ReturnType<typeof tileset>; s: ReturnType<typeof tileset> } {
    const p = tileset(640, false);
    const s = tileset(4, true);
    // ブロック 0: 下層は全部タイル 0（背景色で塗る）、上層は左上にタイル 2（緑の 1 画素）
    p.blocks.set([0, 0, 0, 0, 2, 0, 0, 0], 0);
    // ブロック 1（3 枚目の元）: 下層の右下にタイル 3（青の 1 画素）、上層は全部タイル 1（赤。使われないはず）
    p.blocks.set([0, 0, 0, 3, 1, 1, 1, 1], 8);
    return { p, s };
  }

  it("3 層にすると次のブロックの下層だけが透けて重なる", () => {
    const { p, s } = build();
    const before = new BlockRenderer(p, s).render(0).slice();
    expect(px(before, 15, 15)).toEqual(WHITE);
    p.attributes[0] = 0x30000000;
    const image = new BlockRenderer(p, s).render(0);
    expect(px(image, 0, 0)).toEqual(GREEN);
    expect(px(image, 15, 15)).toEqual(BLUE);
    // 3 枚目の色 0 は透ける（上層の赤も使わない）
    expect(px(image, 4, 4)).toEqual(WHITE);
    expect(px(image, 8, 8)).toEqual(WHITE);
  });

  it("値 1・5〜7 は今のまま 2 層で描く", () => {
    for (const v of [0x10000000, 0x50000000, 0x70000000]) {
      const { p, s } = build();
      p.attributes[0] = v;
      expect(px(new BlockRenderer(p, s).render(0), 15, 15)).toEqual(WHITE);
    }
  });

  it("表の最後のブロックを 3 層にしても例外にならず、3 枚目は描かない", () => {
    const { p, s } = build();
    p.blocks.set([0, 0, 0, 0, 1, 0, 0, 0], 639 * 8);
    p.attributes[639] = 0x30000000;
    s.blocks.set([0, 0, 0, 3, 0, 0, 0, 0], 0);
    s.blocks.set([0, 0, 0, 0, 0, 0, 0, 0], 3 * 8);
    s.attributes[3] = 0x30000000;
    const r = new BlockRenderer(p, s);
    const last = r.render(639);
    expect(px(last, 0, 0)).toEqual(RED);
    // 副の 640 番（右下に青）は重ねない
    expect(px(last, 15, 15)).toEqual(WHITE);
    expect(() => r.render(643)).not.toThrow();
  });
});
