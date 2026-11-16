import { expect, it } from "vitest";
import { actorBgPriority, BlockRenderer, BPRJ_OFFSETS, createImage, hasTripleLayerBlocks, renderGameScene, Rom, viewportFrame, type PlaybackActorState, type Tileset } from "../src/index.js";

function fixture(mode: number) {
  const tiles = new Uint8Array(32 * 21);
  tiles.fill(0x11, 32, 64); tiles.fill(0x22, 64, 96); tiles.fill(0x33, 96, 128);
  tiles.fill(0x44, 20 * 32);
  const palettes = new Uint16Array(256);
  for (let p = 0; p < 16; p++) palettes.set([0x7fff, 31, 31 << 10, 0x3ff, 31 << 5], p * 16);
  const blocks = new Uint16Array(16);
  blocks.fill(1, 0, 4); blocks.fill(2, 4, 8); blocks.fill(3, 8, 12);
  const primary: Tileset = {
    header: { offset: 0, isCompressed: false, isSecondary: false, tilesOffset: 0, palettesOffset: 0, blocksOffset: 0, callback: 0, attributesOffset: 0 },
    tiles, palettes, blocks, attributes: new Uint32Array([mode, 0]),
  };
  const renderer = new BlockRenderer(primary, { ...primary, blocks: new Uint16Array(), attributes: new Uint32Array() });
  const state: PlaybackActorState = {
    id: 1, graphicsId: 0, tileX: 0, tileY: 0, pixelX: 0, pixelY: 0, height: 0,
    facing: "down", sprite: "stand", actionFrame: 0, movementId: null,
    visible: true, present: true, shadow: false, mark: null, elevation: 3, fixedPriority: false, animHold: false,
  };
  const actorImage = createImage(8, 8);
  for (let i = 0; i < actorImage.data.length; i += 4) actorImage.data.set([0, 255, 0, 255], i);
  return { renderer, primary, state, actorImage };
}
const view = { x: 0, y: 0, width: 16, height: 16 };
const pixel = (image: { data: Uint8ClampedArray }, x = 4, y = 8) => [...image.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];

it("通常のBG1は人物を覆い、人物に覆われる重ね方では人物が手前になる", () => {
  for (const cfru of [false, true]) {
    for (const covered of [false, true]) {
      const mode = covered ? 0x20000000 : 0;
      const { renderer, state, actorImage } = fixture(mode);
      const { image, unknownBlocks } = renderGameScene(renderer, view, () => 0, [{ state, image: actorImage }], cfru);
      expect(pixel(image)).toEqual(covered ? [0, 255, 0, 255] : [0, 0, 255, 255]);
      expect(unknownBlocks).toEqual([]);
    }
  }
});

it("3枚目は前景になり、異なるelevationと固定したpriorityでも重なる", () => {
  const { renderer, state, actorImage } = fixture(0x30000000);
  const render = (elevation: number, priority?: number) => renderGameScene(renderer, view, () => 0, [{ state: { ...state, elevation }, image: actorImage, priority }], true).image;
  expect(pixel(render(3))).toEqual([255, 255, 0, 255]);
  expect(pixel(render(4))).toEqual([0, 255, 0, 255]);
  expect(pixel(render(4, 2))).toEqual([255, 255, 0, 255]);
  expect(actorBgPriority(3)).toBe(2);
  expect(actorBgPriority(4)).toBe(1);
});

it("色0だけを透かし、下にBG3の決まったタイルを描く。元の編集画像は変えない", () => {
  const { renderer, primary } = fixture(0);
  primary.blocks.fill(0, 0, 8);
  const before = renderer.render(0).slice();
  expect(pixel(renderGameScene(renderer, view, () => 0, [], false).image)).toEqual([0, 255, 0, 255]);
  expect(renderer.render(0)).toEqual(before);
  // 色番号1と0が同じ色でも、実機の色番号1は透明にはならない。
  primary.blocks.fill(1, 0, 4); primary.palettes[1] = primary.palettes[0]!;
  const fresh = new BlockRenderer(primary, primary);
  expect(pixel(renderGameScene(fresh, view, () => 0, [], false).image)).toEqual([255, 255, 255, 255]);
});

it("未知の重ね方は報告し、影を地面に残して人物だけを持ち上げる", () => {
  const { renderer, state, actorImage } = fixture(0x70000000);
  expect(renderGameScene(renderer, view, () => 0, [], true).unknownBlocks).toEqual([0]);
  const shadow = createImage(8, 2); shadow.data.fill(255);
  const { image } = renderGameScene(renderer, view, () => null, [{ state: { ...state, height: -8, shadow: true }, image: actorImage, shadow }], true);
  expect(pixel(image, 4, 0)).toEqual([0, 255, 0, 255]);
  expect(pixel(image, 4, 14)).toEqual([255, 255, 255, 255]);
});

it("頭上の印は人物の中心から16px上で、独立したBG優先度1を使う", () => {
  const { renderer, state } = fixture(0);
  const body = createImage(16, 32), mark = createImage(4, 4);
  for (let i = 0; i < body.data.length; i += 4) body.data.set([0, 255, 0, 255], i);
  for (let i = 0; i < mark.data.length; i += 4) mark.data.set([255, 0, 0, 255], i);
  const actor = { state: { ...state, pixelY: 32, mark: { mark: "exclaim", frame: 10 } }, image: body, mark };
  const image = renderGameScene(renderer, { ...view, height: 48 }, () => 0, [actor], false).image;
  // 体はBG1の後ろ。印はBG1より手前で、top=14。
  expect(pixel(image, 6, 16)).toEqual([255, 0, 0, 255]);
  expect(pixel(image, 6, 13)).toEqual([0, 0, 255, 255]);
  expect(pixel(image, 6, 24)).toEqual([0, 0, 255, 255]);
  const risen = renderGameScene(renderer, { ...view, height: 48 }, () => 0, [{ ...actor, markOffsetY: -5 }], false).image;
  expect(pixel(risen, 6, 10)).toEqual([255, 0, 0, 255]);
  expect(pixel(risen, 6, 16)).toEqual([0, 0, 255, 255]);
});

it("対応した描画フックだけを検出し、別の関数や範囲外を同じ改造として扱わない", () => {
  const bytes = new Uint8Array(64);
  const data = new DataView(bytes.buffer);
  const rom = new Rom(bytes);
  const offsets = { ...BPRJ_OFFSETS, drawBlockHook: 0 };
  expect(hasTripleLayerBlocks(rom, offsets)).toBe(false);
  data.setUint32(0, 0x47084900, true); data.setUint32(4, 0x08000021, true);
  data.setUint32(0x20, 0x0c120412, true); data.setUint16(0x24, 0x2804, true);
  expect(hasTripleLayerBlocks(rom, offsets)).toBe(true);
  data.setUint16(0x24, 0x2803, true);
  expect(hasTripleLayerBlocks(rom, offsets)).toBe(false);
  data.setUint32(4, 0x080000ff, true);
  expect(hasTripleLayerBlocks(rom, offsets)).toBe(false);
});

it("画面枠の足元は120,88で、端を丸めずカメラの移動と揺れを反映する", () => {
  const camera = { target: 255, x: 16, y: 32, shakeX: 0, shakeY: 0 };
  const frame = viewportFrame(camera);
  expect(frame).toEqual({ x: -96, y: -40, width: 240, height: 160 });
  expect([camera.x + 8 - frame.x, camera.y + 16 - frame.y]).toEqual([120, 88]);
  expect(viewportFrame({ ...camera, x: 18, y: 31, shakeX: 2, shakeY: -3 }))
    .toEqual({ x: -92, y: -44, width: 240, height: 160 });
});

it("同じBG優先度では足元のYで重なり、固定したOBJの順は動かさない", () => {
  const { renderer, state } = fixture(0);
  const back = createImage(16, 32), front = createImage(16, 32);
  for (let at = 0; at < back.data.length; at += 4) {
    back.data.set([0, 255, 0, 255], at); front.data.set([255, 0, 0, 255], at);
  }
  const a = { state, image: back };
  const b = { state: { ...state, id: 2, pixelY: 16 }, image: front };
  expect(pixel(renderGameScene(renderer, view, () => null, [a, b], false).image)).toEqual([255, 0, 0, 255]);
  const fixed = { ...b, state: { ...b.state, fixedPriority: true, subpriority: 200 } };
  expect(pixel(renderGameScene(renderer, view, () => null, [a, fixed], false).image)).toEqual([0, 255, 0, 255]);
});

it("重ね描きは背景を透明にし、人物の上に来るBGだけを描く", () => {
  const { renderer, state, actorImage } = fixture(0);
  const scene = (actors: Parameters<typeof renderGameScene>[3]) => renderGameScene(renderer, view, () => 0, actors, false, undefined, { overlay: true }).image;
  // 人物が無ければ全部透明。
  expect(scene([]).data.every(v => v === 0)).toBe(true);
  // 通常のブロックのBG1は人物（priority 2）の上に来るので、人物の場所に描く。人物の外もBG1は描くが、BG2・BG3は描かない。
  const covered = scene([{ state, image: actorImage }]);
  expect(pixel(covered)).toEqual([0, 0, 255, 255]);
  const full = renderGameScene(renderer, view, () => 0, [{ state, image: actorImage }], false).image;
  for (let i = 0; i < full.data.length; i += 4) {
    if (covered.data[i + 3]) expect([...covered.data.slice(i, i + 4)]).toEqual([...full.data.slice(i, i + 4)]);
  }
  // 人物に覆われる重ね方なら人物が見える。
  const { renderer: r2, state: s2, actorImage: a2 } = fixture(0x20000000);
  expect(pixel(renderGameScene(r2, view, () => 0, [{ state: s2, image: a2 }], false, undefined, { overlay: true }).image)).toEqual([0, 255, 0, 255]);
});
