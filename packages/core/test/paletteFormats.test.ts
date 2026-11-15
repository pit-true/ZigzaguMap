import { describe, expect, it } from "vitest";
import { EditError, PaletteFile, colorUsage, unusedColors } from "../src/index.js";

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
/** 色 i を (i*16, i*8, 255-i*16) にした 16 色。 */
const rgb = Array.from({ length: 16 }, (_, i) => [i * 16, i * 8, 255 - i * 16] as const);
const bgr = rgb.map(([r, g, b]) => (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10));

function editError(f: () => unknown): EditError {
  try {
    f();
  } catch (e) {
    if (e instanceof EditError) return e;
    throw e;
  }
  throw new Error("EditError が出ない");
}

describe("パレットの形式（#396）", () => {
  it("AdvanceMap の .pal（64 バイト）は今までどおり", () => {
    const bytes = PaletteFile.write(bgr);
    expect(PaletteFile.readAny(bytes)).toEqual({ format: "am", colors: bgr });
    expect(editError(() => PaletteFile.readAny(new Uint8Array(65))).params).toEqual({ length: 65 });
  });
  it("JASC-PAL", () => {
    const text = ["JASC-PAL", "0100", "16", ...rgb.map((c) => c.join(" ")), ""].join("\r\n");
    expect(PaletteFile.readAny(enc(text))).toEqual({ format: "jasc", colors: bgr });
    const short = ["JASC-PAL", "0100", "4", ...rgb.slice(0, 4).map((c) => c.join(" "))].join("\n");
    expect(editError(() => PaletteFile.readAny(enc(short))).params).toEqual({ format: "jasc", colors: 4 });
  });
  it("GIMP の .gpl（Name・Columns・# の行と色の名前は飛ばす）", () => {
    const text = ["GIMP Palette", "Name: test", "Columns: 8", "#", ...rgb.map((c, i) => `${c.join("\t")}\tcolor${i}`), ""].join("\n");
    expect(PaletteFile.readAny(enc(text))).toEqual({ format: "gimp", colors: bgr });
    const many = ["GIMP Palette", ...rgb.map((c) => c.join(" ")), "1 2 3"].join("\n");
    expect(editError(() => PaletteFile.readAny(enc(many))).params).toEqual({ format: "gimp", colors: 17 });
  });
  it("Adobe の .act（772 バイトは色の数を読み、768 バイトは後ろの黒を除く）", () => {
    const act = new Uint8Array(772);
    rgb.forEach((c, i) => act.set(c, i * 3));
    act[769] = 16;
    expect(PaletteFile.readAny(act)).toEqual({ format: "act", colors: bgr });
    expect(PaletteFile.readAny(act.subarray(0, 768))).toEqual({ format: "act", colors: bgr });
    act[769] = 20;
    expect(editError(() => PaletteFile.readAny(act)).params).toEqual({ format: "act", colors: 20 });
    const full = act.slice(0, 768);
    full[767] = 1;
    expect(editError(() => PaletteFile.readAny(full)).params).toEqual({ format: "act", colors: 256 });
  });
});

describe("色の使用箇所（#396）", () => {
  // 主のタイル 0: 全部の点が色 1、タイル 1: 色 2 と 3。副のタイル 0x280: 色 5
  const primaryTiles = new Uint8Array(32 * 2);
  primaryTiles.fill(0x11, 0, 32);
  primaryTiles.fill(0x32, 32, 64);
  const secondaryTiles = new Uint8Array(32).fill(0x55);
  const block = (...refs: number[]) => Uint16Array.from([...refs, ...Array(8 - refs.length).fill(refs[0])]);
  const input = (palette: number) => ({
    // 主のブロック 0: パレット 2 のタイル 0、ブロック 1: パレット 3 のタイル 1
    primaryBlocks: Uint16Array.from([...block(0x2000), ...block(0x3001)]),
    // 副のブロック 0: パレット 2 の 0x280 と、パレット 2 のタイル 1（反転つき）
    secondaryBlocks: Uint16Array.from([...block(0x2280, 0x2c01)]),
    primaryTiles,
    secondaryTiles,
    palette,
  });
  it("そのパレットで描くタイルの点の色を、ブロックごとに数える", () => {
    const u = colorUsage(input(2));
    expect(u[1]).toEqual([0]);
    expect(u[2]).toEqual([640]);
    expect(u[3]).toEqual([640]);
    expect(u[5]).toEqual([640]);
    expect(u[4]).toEqual([]);
    expect(unusedColors(input(2))).toEqual([0, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(unusedColors(input(3))).toEqual([0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});
