import { describe, expect, it } from "vitest";
import { Rom, RomError, decompressLz77, detectGame, requireSupportedGame } from "../src/index.js";
import { buildSyntheticRom, compressLiteralLz77 } from "./helpers/syntheticRom.js";

describe("Rom", () => {
  const rom = new Rom(Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x00, 0x10, 0x00, 0x08, 0xff]));

  it("u8 / u16 / u32 / s8 をリトルエンディアンで読む", () => {
    expect(rom.u8(0)).toBe(0x12);
    expect(rom.u16(0)).toBe(0x3412);
    expect(rom.u32(0)).toBe(0x78563412);
    expect(rom.u32(4)).toBe(0x08001000);
    expect(rom.s8(8)).toBe(-1);
  });

  it("範囲外は RomError", () => {
    expect(() => rom.u8(9)).toThrow(RomError);
    expect(() => rom.u16(8)).toThrow(RomError);
    expect(() => rom.u32(-1)).toThrow(RomError);
    expect(rom.inRange(5, 4)).toBe(true);
    expect(rom.inRange(6, 4)).toBe(false);
  });

  it("u16Array で配列を読む", () => {
    expect([...rom.u16Array(0, 2)]).toEqual([0x3412, 0x7856]);
  });
});

describe("Rom のポインタ", () => {
  it("ROM 外を指すと RomError、0 は null", () => {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setUint32(0, 0x08000008, true);
    new DataView(bytes.buffer).setUint32(4, 0x08001000, true);
    const rom = new Rom(bytes);
    expect(rom.pointer(0)).toBe(8);
    expect(() => rom.pointer(4)).toThrow(RomError);
    expect(rom.pointerOrNull(8)).toBeNull();
  });
});

describe("LZ77", () => {
  it("リテラルと後方参照を展開する", () => {
    const data = Uint8Array.from([0x10, 0x09, 0x00, 0x00, 0x10, 0x41, 0x42, 0x43, 0x30, 0x02]);
    expect(new TextDecoder().decode(decompressLz77(data, 0))).toBe("ABCABCABC");
  });

  it("リテラルだけの圧縮を元に戻す", () => {
    const original = Uint8Array.from({ length: 100 }, (_, i) => (i * 7) & 0xff);
    expect(decompressLz77(compressLiteralLz77(original), 0)).toEqual(original);
  });

  it("壊れたデータは RomError", () => {
    expect(() => decompressLz77(Uint8Array.from([0x11, 1, 0, 0]), 0)).toThrow(RomError);
    expect(() => decompressLz77(Uint8Array.from([0x10, 9, 0, 0, 0x00, 0x41]), 0)).toThrow(RomError);
    expect(() => decompressLz77(Uint8Array.from([0x10, 4, 0, 0, 0x80, 0x00, 0x05]), 0)).toThrow(RomError);
  });
});

describe("ゲーム判定", () => {
  it("BPRJ を判定する", () => {
    const info = detectGame(new Rom(buildSyntheticRom()));
    expect(info.code).toBe("BPRJ");
    expect(info.title).toBe("POKEMON FIRE");
    expect(info.revision).toBe(0);
    expect(info.offsets?.mapBankTablePointer).toBe(0x54b0c);
  });

  it("対応していないゲームは offsets が null、require で RomError", () => {
    const bytes = buildSyntheticRom();
    bytes.set([0x41, 0x58, 0x56, 0x4a], 0xac); // AXVJ
    const rom = new Rom(bytes);
    expect(detectGame(rom).offsets).toBeNull();
    expect(() => requireSupportedGame(rom)).toThrow(RomError);
  });
});
