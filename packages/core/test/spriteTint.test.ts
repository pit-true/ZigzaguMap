import { expect, it } from "vitest";
import { OverworldSprites, Rom } from "../src/index.js";

it("OBJの実際のパレット番号を渡して色を変え、透明画素・元の画像・ROMを保つ", () => {
  const data = new Uint8Array(1024);
  const view = new DataView(data.buffer);
  const ptr = (at: number, to: number) => view.setUint32(at, 0x08000000 + to, true);
  ptr(0, 0x20); ptr(4, 0x30); ptr(0x20, 0x40);
  ptr(0x30, 0x100); view.setUint16(0x34, 0x1100, true);
  view.setUint16(0x40, 0xffff, true); view.setUint16(0x42, 0x1100, true);
  view.setUint16(0x48, 8, true); view.setUint16(0x4a, 8, true); data[0x4c] = 3;
  ptr(0x5c, 0x80); ptr(0x80, 0x140); view.setUint16(0x84, 32, true);
  view.setUint16(0x102, 31, true); data.fill(0x11, 0x140, 0x160); data[0x140] = 0x10;
  const before = data.slice();
  const sprites = OverworldSprites.read(new Rom(data), 0, 4);
  const day = sprites.image(0)!;
  const night = sprites.image(0, (colors, slot) => {
    expect(slot).toBe(3);
    const out = Uint16Array.from(colors); out[1] = 31 << 10; return out;
  })!;
  expect([...day.data.slice(0, 8)]).toEqual([0, 0, 0, 0, 255, 0, 0, 255]);
  expect([...night.data.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 255, 255]);
  expect(sprites.image(0)).toBe(day);
  expect(data).toEqual(before);
});
