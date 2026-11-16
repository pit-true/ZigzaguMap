import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readMessageFrame, requireSupportedGame, Rom } from "../src/index.js";

function fixture() {
  const bytes = new Uint8Array(1024), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x08000100, true); view.setUint32(4, 0x08000020, true);
  for (let i = 0; i < 16; i++) { view.setUint16(0x20 + i * 2, i, true); view.setUint16(0x60 + i * 2, i << 5, true); }
  for (let i = 0; i < 20; i++) bytes.fill(((i % 15 + 1) << 4) | (i % 15 + 1), 0x100 + i * 32, 0x120 + i * 32);
  bytes[0x100] = 0x12; bytes[0x103] = 0x31;
  return { bytes, rom: new Rom(bytes) };
}

it("通常の枠の上下反転、本文の背景と文字色をROMから読む", () => {
  const { rom, bytes } = fixture(), before = bytes.slice();
  const result = readMessageFrame(rom, 0, 4, "vanilla")!;
  const pixel = (x: number, y: number) => result.image.data[(y * 240 + x) * 4];
  expect([result.image.width, result.image.height, result.textColor]).toEqual([240, 48, 2]);
  expect(pixel(0, 0)).toBe(16); expect(pixel(0, 40)).toBe(8); expect(pixel(0, 47)).toBe(16);
  expect(pixel(20, 20)).toBe(8); expect(pixel(0, 24)).toBe(90);
  expect(bytes).toEqual(before);
});

it("看板は下半分の並びとパレットが通常の枠と異なる", () => {
  const { rom } = fixture();
  const image = readMessageFrame(rom, 0, 4, "sign")!.image;
  expect(image.data[(24 * 240) * 4 + 1]).toBe(49); // tile5、緑6/31
  expect(image.data[(32 * 240) * 4 + 1]).toBe(90); // tile10、緑11/31
});

it("Chronosの上下別の絵と右内側の専用タイルを使う", () => {
  const { rom } = fixture();
  const image = readMessageFrame(rom, 0, 4, "chronos")!.image;
  const red = (x: number, y: number) => image.data[(y * 240 + x) * 4];
  expect(red(232, 0)).toBe(24); expect(red(239, 0)).toBe(16);
  expect(red(224, 0)).toBe(107); expect(red(16, 40)).toBe(99);
  expect(readMessageFrame(new Rom(new Uint8Array(4)), 0, 4, "vanilla")).toBeNull();
});

it.skipIf(!process.env.ZIGZAGU_TEST_ROM)("実ROMのメッセージ枠を参照先から読み、ROMを保つ", () => {
  const rom = new Rom(new Uint8Array(readFileSync(process.env.ZIGZAGU_TEST_ROM!))), before = rom.bytes.slice();
  const offsets = requireSupportedGame(rom).offsets;
  const result = readMessageFrame(rom, offsets.messageFrameTilesPointer, offsets.textWindowPalettesPointer, "vanilla");
  expect(result?.image.data.some(value => value > 0)).toBe(true);
  expect(rom.bytes).toEqual(before);
});
