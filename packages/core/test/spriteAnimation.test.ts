import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ActorAnimator, OverworldSprites, PlaybackAnimation, Rom, SpriteAnimation, Timeline, movementAction, requireSupportedGame, type OverworldAnimationCommand, type PlaybackActorState } from "../src/index.js";
import type { ActorBase } from "../src/script/playback/Timeline.js";

const image = (index: number, duration = 2): OverworldAnimationCommand => ({ kind: "frame", frame: { index, hFlip: false, vFlip: false }, duration });
const actor: PlaybackActorState = {
  id: 1, graphicsId: 0, tileX: 0, tileY: 0, pixelX: 0, pixelY: 0, height: 0,
  facing: "down", sprite: "stand", movementId: null, actionFrame: 0, visible: true, present: true,
  shadow: false, mark: null, elevation: 3, fixedPriority: false, animHold: false,
};

function fixture() {
  const bytes = new Uint8Array(0x4000), v = new DataView(bytes.buffer);
  const ptr = (at: number, to: number) => v.setUint32(at, 0x08000000 + to, true);
  const word = (at: number, value: number) => v.setUint16(at, value, true);
  ptr(0, 0x20); ptr(4, 0x30); ptr(8, 0x380); ptr(0x20, 0x40); ptr(0x30, 0x100);
  word(0x34, 7); word(0x40, 0xffff); word(0x42, 7); word(0x48, 8); word(0x4a, 8);
  ptr(0x58, 0x180); ptr(0x5c, 0x80);
  for (let i = 0; i < 3; i++) { ptr(0x80 + i * 8, 0x300 + i * 32); word(0x84 + i * 8, 32); }
  ptr(0x380, 0x180); bytes.set([1, 3, 0, 2], 0x384);
  for (let a = 0; a < 24; a++) {
    const at = 0x400 + a * 32; ptr(0x180 + a * 4, at);
    const commands = a < 4 ? [[0, 16], [0xfffe, 0]] : [[1, a < 8 ? 8 : 4], [0, a < 8 ? 8 : 4], [2, a < 8 ? 8 : 4], [0, a < 8 ? 8 : 4], [0xfffe, 0]];
    commands.forEach(([frame, duration], i) => { word(at + i * 4, frame!); word(at + i * 4 + 2, duration!); });
  }
  return { bytes, sprites: OverworldSprites.read(new Rom(bytes), 0, 4, 8) };
}

it("時計はduration、JUMP、有限LOOP、ENDを逐次実行する", () => {
  const commands: OverworldAnimationCommand[] = [image(0, 1), image(1, 1), { kind: "loop", count: 2 }, image(2, 2), { kind: "end" }];
  const clock = new SpriteAnimation((_, c) => commands[c] ?? null);
  expect(Array.from({ length: 10 }, () => clock.tick()?.index)).toEqual([0, 1, 0, 1, 0, 1, 2, 2, 2, 2]);
  const loop = new SpriteAnimation((_, c) => [image(0), image(1), { kind: "jump", target: 0 } as const][c] ?? null);
  expect(Array.from({ length: 8 }, () => loop.tick()?.index)).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
});

it("停止は待ち時間を保ち、コマ指定は同じフレームのtickを補償する", () => {
  const clock = new SpriteAnimation((_, c) => [image(0), image(1), { kind: "end" } as const][c] ?? null);
  expect(clock.tick()?.index).toBe(0);
  clock.paused = true;
  expect(Array.from({ length: 5 }, () => clock.tick()?.index)).toEqual([0, 0, 0, 0, 0]);
  clock.paused = false;
  expect(clock.tick()?.index).toBe(0); expect(clock.tick()?.index).toBe(1);
  clock.changeAt(0, 0);
  expect([clock.tick()?.index, clock.tick()?.index, clock.tick()?.index]).toEqual([0, 0, 1]);
  clock.restart(0); expect(clock.tick()?.index).toBe(0);
});

it("制御だけの循環や範囲外を有限時間で拒む", () => {
  const cycle = new SpriteAnimation(() => ({ kind: "jump", target: 0 }));
  expect(cycle.tick()).toBeNull(); expect(cycle.failed).toBe(true);
  const missing = new SpriteAnimation(() => null);
  expect(missing.tick()).toBeNull(); expect(missing.failed).toBe(true);
});

it("表の番号だけを替える場合は画像を保ち反転だけを更新する", () => {
  const clock = new SpriteAnimation((a, c) => c === 0 ? { kind: "frame", frame: { index: a, hFlip: a === 1, vFlip: a === 1 }, duration: 4 } : { kind: "end" });
  expect(clock.tick()).toEqual({ index: 0, hFlip: false, vFlip: false });
  clock.select(1);
  expect(clock.tick()).toEqual({ index: 0, hFlip: true, vFlip: true });
});

it("速さとジャンプ途中の向き変更は足の位置を引き継ぐ", () => {
  const { sprites } = fixture(), clock = new ActorAnimator(sprites);
  for (let f = 0; f < 16; f++) clock.advance({ ...actor, movementId: 0x10, actionFrame: f });
  expect(clock.advance({ ...actor, movementId: 0x1e, facing: "up", actionFrame: 0 })?.index).toBe(2);
  const jump = new ActorAnimator(sprites);
  const frames = Array.from({ length: 16 }, (_, f) => jump.advance({ ...actor, movementId: 0x56, sprite: "jump", facing: f < 7 ? "down" : "up", actionFrame: f })?.index);
  expect(frames.slice(0, 7)).toEqual(Array(7).fill(1));
  expect(frames.slice(7)).toEqual(Array(9).fill(0));
});

it("歩行表を読めない場合は診断し、認識しない表には標準値を当てはめない", () => {
  const { bytes } = fixture();
  const missing = new ActorAnimator(OverworldSprites.read(new Rom(bytes), 0, 4));
  expect(missing.advance({ ...actor, movementId: 0x10 })).toBeNull();
  expect(missing.reason).toBe("walkingTable");
  new DataView(bytes.buffer).setUint32(0x380, 0x08000184, true);
  const unknown = OverworldSprites.read(new Rom(bytes), 0, 4, 8);
  expect(unknown.walkingOffsets(0)).toBeNull();
  const clock = new ActorAnimator(unknown);
  expect(clock.advance({ ...actor, movementId: 0x10 })?.index).toBe(1);
  expect(clock.reason).toBeNull();
});

it("連続歩行は左右の足を交互にし、停止・向き変更でも姿勢を保つ", () => {
  const { sprites, bytes } = fixture(), before = bytes.slice(), clock = new ActorAnimator(sprites);
  const frames = Array.from({ length: 32 }, (_, f) => clock.advance({ ...actor, sprite: "walk", movementId: 0x10, actionFrame: f % 16 })?.index);
  expect(frames).toEqual([...Array(8).fill(1), ...Array(8).fill(0), ...Array(8).fill(2), ...Array(8).fill(0)]);
  expect(clock.advance(actor)?.index).toBe(0);
  expect(clock.advance({ ...actor, movementId: 1, facing: "up" })?.index).toBe(0);
  expect(clock.reason).toBeNull(); expect(bytes).toEqual(before);
});

it("HOLD_ANMは現在のアニメーションを再開し、非表示中も時計は進む", () => {
  const { sprites } = fixture(), clock = new ActorAnimator(sprites);
  clock.advance({ ...actor, movementId: 0x10, actionFrame: 0 });
  for (let f = 1; f < 16; f++) clock.advance({ ...actor, movementId: 0x10, actionFrame: f });
  // 新しい歩きへ切り替えず、停止したアニメーションの次の足へ進む。
  const held = Array.from({ length: 3 }, (_, f) => clock.advance({ ...actor, movementId: 0x11, actionFrame: f, facing: "up", animHold: true, visible: false })?.index);
  expect(held).toEqual([0, 2, 2]);
  expect(clock.advance({ ...actor, present: false })).toBeNull();
  expect(clock.advance(actor)?.index).toBe(0);
});

it("記録済みの絵は逆順の参照でも同じになり、1フレーム2バイトに収まる", () => {
  const { sprites } = fixture();
  const base: ActorBase = { ...actor, lockFacing: false };
  const action = movementAction(0x10)!;
  const timeline = new Timeline([{ id: 1, initial: base, marks: [], changes: [0, 16].map(frame => ({ type: "step", frame, base, action, offset: 0, playerFacing: "down", toPlayer: null, defaultFacing: "down" })) }], [], [], [], [], [], 40);
  const baked = new PlaybackAnimation(timeline, sprites);
  const forward = Array.from({ length: 41 }, (_, f) => baked.stateAt(f).actors[0]!.animationFrame);
  expect(Array.from({ length: 41 }, (_, f) => baked.stateAt(40 - f).actors[0]!.animationFrame).reverse()).toEqual(forward);
  expect(forward[0]?.index).toBe(1); expect(forward[16]?.index).toBe(2);
  expect(baked.byteLength).toBe(82); expect(baked.issues).toEqual([]);
  expect(timeline.actorAt(1, 7)).toEqual(timeline.stateAt(7).actors[0]);
  expect(timeline.actorAt(2, 7)).toBeNull();
  expect(() => new PlaybackAnimation(new Timeline([], [], [], [], [], [], 36_001), sprites)).toThrow(RangeError);
});

it("64人・60秒の記録量と計算時間を測る", () => {
  const { sprites } = fixture();
  const base: ActorBase = { ...actor, lockFacing: false };
  const changes = Array.from({ length: 225 }, (_, i) => ({ type: "step" as const, frame: i * 16, base, action: movementAction(0x10)!, offset: 0, playerFacing: "down" as const, toPlayer: null, defaultFacing: "down" as const }));
  const timeline = new Timeline(Array.from({ length: 64 }, (_, id) => ({ id, initial: base, changes, marks: [] })), [], [], [], [], [], 3600);
  const start = performance.now();
  const baked = new PlaybackAnimation(timeline, sprites);
  console.log(`64人60秒の絵: ${Math.round(performance.now() - start)}ms、${baked.byteLength}bytes`);
  expect(baked.byteLength).toBe(64 * 3601 * 2); expect(baked.issues).toEqual([]);
  expect(baked.stateAt(3600).actors.every(a => a.animationFrame?.index === 0)).toBe(true);
});

it.skipIf(!process.env.ZIGZAGU_TEST_ROM)("実ROMの主人公も左右の足を交互に使う", () => {
  const rom = new Rom(new Uint8Array(readFileSync(process.env.ZIGZAGU_TEST_ROM!)));
  const offsets = requireSupportedGame(rom).offsets;
  const sprites = OverworldSprites.read(rom, offsets.overworldGraphicsTablePointer, offsets.overworldPaletteTablePointer, offsets.overworldWalkingTablePointer);
  for (const graphicsId of [0, 7, 1]) {
    expect(sprites.walkingOffsets(graphicsId)).toEqual({ stopLeft: 1, stopRight: 3, walkLeft: 0, walkRight: 2 });
    const clock = new ActorAnimator(sprites);
    const frames = Array.from({ length: 32 }, (_, f) => clock.advance({ ...actor, graphicsId, movementId: 0x10, sprite: "walk", actionFrame: f % 16 }));
    expect(frames.every(Boolean)).toBe(true);
    expect(frames[0]?.index).not.toBe(frames[16]?.index);
    expect(clock.reason).toBeNull();
  }
});
