import { expect, it } from "vitest";
import { actorFrame, actorImagePosition, OverworldSprites, Rom, type PlaybackActorState } from "../src/index.js";

function fixture(commands: readonly (readonly [number, number])[]) {
  const bytes = new Uint8Array(4096);
  const view = new DataView(bytes.buffer);
  const word = (at: number, value: number) => view.setUint16(at, value, true);
  const ptr = (at: number, target: number) => view.setUint32(at, 0x08000000 + target, true);
  ptr(0, 0x20); ptr(4, 0x30); ptr(0x20, 0x40); ptr(0x30, 0x100);
  word(0x34, 7); word(0x40, 0xffff); word(0x42, 7); word(0x48, 8); word(0x4a, 8);
  ptr(0x58, 0x180); ptr(0x180, 0x200); ptr(0x5c, 0x80);
  ptr(0x80, 0x300); word(0x84, 32); ptr(0x88, 0x320); word(0x8c, 32);
  word(0x102, 31); word(0x104, 31 << 10);
  bytes[0x300] = 1; bytes[0x320] = 2;
  commands.forEach(([frame, arg], i) => { word(0x200 + i * 4, frame); word(0x202 + i * 4, arg); });
  return { bytes, sprites: OverworldSprites.read(new Rom(bytes), 0, 4) };
}

it("コマの境界と終了後の最終姿勢を ROM の duration で決める", () => {
  const { sprites } = fixture([[0, 2], [1, 3 | 64], [0xffff, 0]]);
  expect([0, 1, 2, 4, 5, 100].map(t => sprites.animationFrame(0, 0, t)))
    .toEqual([0, 0, 1, 1, 1, 1].map(index => ({ index, hFlip: index === 1, vFlip: false })));
});

it("JUMP の周期を大きな時刻でもたどり、有限 LOOP は指定回数で抜ける", () => {
  const cyclic = fixture([[0, 2], [1, 2], [0xfffe, 0]]).sprites;
  expect(cyclic.animationFrame(0, 0, 1_000_002)?.index).toBe(1);
  const counted = fixture([[0, 1], [1, 1], [0xfffd, 2], [0, 4], [0xffff, 0]]).sprites;
  expect(Array.from({ length: 8 }, (_, t) => counted.animationFrame(0, 0, t)?.index)).toEqual([0, 1, 0, 1, 0, 1, 0, 0]);
});

it("指定コマと反転を描き、既定画像・ROM を保つ", () => {
  const { bytes, sprites } = fixture([[1, 64 | 128 | 1], [0xffff, 0]]);
  const before = bytes.slice();
  const plain = sprites.image(0)!;
  const image = sprites.frameImage(0, sprites.animationFrame(0, 0, 0)!)!;
  expect([...image.data.slice(63 * 4)]).toEqual([0, 0, 255, 255]);
  expect([...image.data.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  expect(sprites.image(0)).toBe(plain);
  expect(bytes).toEqual(before);
});

it("不正な参照・制御だけのループ・画像サイズ不足を拒む", () => {
  const { sprites } = fixture([[0xfffe, 0]]);
  expect(sprites.animationFrame(0, 0, 0)).toBeNull();
  expect(sprites.animationFrame(0, -1, 0)).toBeNull();
  expect(sprites.animationFrame(0, 0, NaN)).toBeNull();
  expect(sprites.frameImage(0, { index: 2, hFlip: false, vFlip: false })).toBeNull();
});

it("再生状態の向き・途中の座標・高さ・非表示を共通の描画入力へ変える", () => {
  const { bytes, sprites } = fixture([[0, 1], [0xffff, 0]]);
  const view = new DataView(bytes.buffer);
  // 右向きの立ち姿と歩きに別のアニメーションを置く。
  view.setUint32(0x180 + 3 * 4, 0x08000240, true);
  view.setUint32(0x180 + 7 * 4, 0x08000250, true);
  view.setUint16(0x240, 1, true); view.setUint16(0x242, 65, true);
  view.setUint16(0x244, 0xffff, true);
  view.setUint16(0x250, 1, true); view.setUint16(0x252, 129, true);
  view.setUint16(0x254, 0xffff, true);
  const actor: PlaybackActorState = {
    id: 1, graphicsId: 0, tileX: 2, tileY: 3, pixelX: 28, pixelY: 48, height: -8,
    facing: "right", sprite: "stand", actionFrame: 0, movementId: null,
    visible: true, present: true, shadow: false, mark: null, elevation: 3, fixedPriority: false, animHold: false,
  };
  expect(actorFrame(sprites, actor)).toEqual({ index: 1, hFlip: true, vFlip: false });
  expect(actorFrame(sprites, { ...actor, sprite: "walk" })).toEqual({ index: 1, hFlip: false, vFlip: true });
  expect(actorImagePosition(actor, 16, 32)).toEqual({ x: 28, y: 24 });
  expect(actorImagePosition(actor, 32, 32)).toEqual({ x: 20, y: 24 });
  expect(actorFrame(sprites, { ...actor, visible: false })).toBeNull();
  expect(actorFrame(sprites, { ...actor, present: false })).toBeNull();
  expect(actorFrame(sprites, { ...actor, graphicsId: -1 })).toBeNull();
});
