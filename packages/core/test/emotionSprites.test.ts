import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { EmotionSprites, emotionRise, OverworldSprites, requireSupportedGame, Rom } from "../src/index.js";

function fixture() {
  const bytes = new Uint8Array(4096), v = new DataView(bytes.buffer);
  const ptr = (at: number, to: number) => v.setUint32(at, 0x08000000 + to, true);
  const word = (at: number, value: number) => v.setUint16(at, value, true);
  ptr(0, 0x20); ptr(4, 0x30); ptr(8, 0x500); ptr(0x20, 0x40); ptr(0x30, 0x100);
  word(0x34, 7); word(0x40, 0xffff); word(0x42, 7); word(0x48, 16); word(0x4a, 32);
  ptr(0x5c, 0x80); ptr(0x80, 0x300); word(0x84, 256);
  word(0x102, 31); word(0x104, 31 << 10); word(0x106, 31 << 5);
  word(0x500, 0xffff); word(0x502, 0xffff); ptr(0x504, 0x540); ptr(0x508, 0x550); ptr(0x50c, 0x580); word(0x542, 0x4000);
  for (let i = 0; i < 5; i++) ptr(0x550 + i * 4, 0x600);
  for (let i = 0; i < 3; i++) { ptr(0x580 + i * 8, 0x700 + i * 128); word(0x584 + i * 8, 128); bytes.fill((i + 1) * 17, 0x700 + i * 128, 0x780 + i * 128); }
  for (const [i, duration] of [4, 4, 52].entries()) { word(0x600 + i * 4, i); word(0x602 + i * 4, duration); }
  word(0x60c, 0xffff);
  const rom = new Rom(bytes), sprites = OverworldSprites.read(rom, 0, 4);
  return { bytes, word, effects: EmotionSprites.read(rom, 8, sprites) };
}

it("頭上の印の4/4/52フレームと主人公のパレットを読む", () => {
  const { bytes, effects } = fixture(), before = bytes.slice();
  expect([0, 3, 4, 7, 8, 59].map(f => [...effects.frame("exclaim", f)!.data.slice(0, 4)]))
    .toEqual([[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255], [0, 255, 0, 255], [0, 255, 0, 255]]);
  expect(effects.frame("exclaim", 60)).toBeNull(); expect(effects.frame("unknown", 0)).toBeNull();
  expect(effects.frame("exclaim", 0, 0, (colors, slot) => { expect(slot).toBe(0); const copy = Uint16Array.from(colors); copy[1] = 31 << 5; return copy; })!.data.slice(0, 4)).toEqual(new Uint8ClampedArray([0, 255, 0, 255]));
  expect(bytes).toEqual(before);
});

it("表の左右反転と、浮き上がって戻る高さを反映する", () => {
  const { bytes, word, effects } = fixture(); bytes.fill(0, 0x700, 0x780); bytes[0x700] = 1;
  word(0x602, 4 | 64);
  const image = effects.frame("exclaim", 0)!;
  expect([...image.data.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  expect([...image.data.slice(15 * 4, 16 * 4)]).toEqual([255, 0, 0, 255]);
  expect(Array.from({ length: 12 }, (_, f) => emotionRise(f))).toEqual([-5, -9, -12, -14, -15, -15, -14, -12, -9, -5, 0, 0]);
});

it.skipIf(!process.env.ZIGZAGU_TEST_ROM)("実ROMの5種類の印を読み出す", () => {
  const rom = new Rom(new Uint8Array(readFileSync(process.env.ZIGZAGU_TEST_ROM!))), o = requireSupportedGame(rom).offsets;
  const sprites = OverworldSprites.read(rom, o.overworldGraphicsTablePointer, o.overworldPaletteTablePointer);
  const effects = EmotionSprites.read(rom, o.emotionTemplatePointer, sprites);
  for (const name of ["exclaim", "question", "cross", "doubleExclaim", "smile"]) for (const f of [0, 4, 8, 59]) {
    const image = effects.frame(name, f)!;
    expect([image.width, image.height]).toEqual([16, 16]); expect(image.data.some(value => value > 0)).toBe(true);
  }
});
