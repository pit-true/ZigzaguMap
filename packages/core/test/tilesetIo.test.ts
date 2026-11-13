import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  PaletteFile,
  Rom,
  TilesetDocument,
  TilesetSourceJson,
  EditError,
  EditErrorCode,
  attributeBytes,
  attributeFromBytes,
  decodeIndexedPng,
  decodeTilesPng,
  deflateZlib,
  encodeIndexedPng,
  encodeTilesPng,
  inflateZlib,
  sha256Hex,
  unpackBlockAttribute,
  unpackTileRef,
} from "../src/index.js";
import { COLORS, SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

const PRIMARY = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
const SECONDARY = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };

describe("SHA-256 と deflate と PNG の書き出し", () => {
  it("SHA-256 の既知の値（16 進の大文字）", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD");
    expect(sha256Hex(new Uint8Array(0))).toBe("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855");
    expect(sha256Hex(new Uint8Array(1000).fill(0x61))).toBe("41EDECE42D63E8D9BF515A9BA6932E1C20CBC9F5A5D134645ADB5DB1B9737EA3");
  });

  it("deflate したものを内蔵の inflate と node:zlib で戻せる", () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => (i % 7 === 0 ? i & 0xff : (i * 31) % 5));
    const z = deflateZlib(data);
    expect(z.length).toBeLessThan(data.length);
    expect(inflateZlib(z)).toEqual(data);
    expect(new Uint8Array(inflateSync(z))).toEqual(data);
    expect(inflateZlib(deflateZlib(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it("インデックス PNG（4bpp）を書いて読み直すと同じ", () => {
    const pixels = Uint8Array.from({ length: 16 * 8 }, (_, i) => i % 16);
    const palette = Uint8Array.from({ length: 48 }, (_, i) => i * 5);
    const png = encodeIndexedPng({ width: 16, height: 8, pixels, palette }, 4);
    const back = decodeIndexedPng(png);
    expect(back).toEqual({ width: 16, height: 8, pixels, palette });
    expect(() => encodeIndexedPng({ width: 1, height: 1, pixels: Uint8Array.of(16), palette }, 4)).toThrow(RangeError);
  });
});

describe("TilesetDocument", () => {
  const rom = new Rom(buildSyntheticRom());

  it("ROM から読む: タイルは 16 枚単位、副はデータの区切りまで", () => {
    const p = TilesetDocument.fromRom(rom, PRIMARY);
    expect(p.tileCount).toBe(16);
    expect(p.compressed).toBe(true);
    expect([...p.header.subarray(4, 16)].every((b) => b === 0)).toBe(true);
    expect(p.palettes[1]).toBe(COLORS.red);
    expect(p.attributes[1]).toBe(0x20000001);
    // ROM 自体は変えない。
    expect(rom.u32(SYN.primaryHeader + 4)).toBe(0x08000000 + SYN.primaryTiles);
    const s = TilesetDocument.fromRom(rom, SECONDARY);
    expect(s.tileCount).toBe(128);
    expect(s.blockCount).toBe(256);
  });

  it("tileset.json と tiles.png に書いて読み直すと同じ（Bochi と同じ項目と整形）", () => {
    const t = TilesetDocument.fromRom(rom, SECONDARY);
    t.tiles[100] = 0x5a;
    const json = t.toJson();
    expect(json.startsWith('{\r\n  "Format": 1,\r\n  "HeaderAddress": ' + SYN.secondaryHeader + ',\r\n  "Secondary": true,\r\n  "New": false,\r\n')).toBe(true);
    expect(json.endsWith("\r\n}\r\n")).toBe(true);
    const source = TilesetSourceJson.parse(json);
    expect(source.imageSha256).toBe(sha256Hex(t.tiles));
    const png = t.toPng();
    const image = decodeIndexedPng(png);
    expect([image.width, image.height]).toEqual([128, (t.tileCount / 16) * 8]);
    // tiles.png の色は副タイルセットならパレット 7（Bochi と同じ）。白 = 0x7FFF → 248。
    expect([...image.palette.subarray(3, 6)]).toEqual([248, 248, 248]);
    const back = TilesetDocument.fromSource(source, png);
    expect(back.toJson()).toBe(json);
    expect(back.tiles).toEqual(t.tiles);
    expect(decodeTilesPng(png, (d) => new Uint8Array(inflateSync(d)))).toEqual(t.tiles);
  });

  it("タイル画像の入出力", () => {
    const tiles = Uint8Array.from({ length: 32 * 3 }, (_, i) => i);
    const png = encodeTilesPng(tiles, new Array(16).fill(0x1f), 3);
    const back = decodeTilesPng(png);
    expect(back.subarray(0, tiles.length)).toEqual(tiles);
    expect(back.length).toBe(32 * 16);
  });
});

describe("パレットファイル（.pal）とブロックの値", () => {
  it("16 色 × R,G,B,0 の 64 バイト（5 ビットを 8 倍）", () => {
    const colors = Array.from({ length: 16 }, (_, i) => (i << 10) | (31 - i) | 0x20);
    const pal = PaletteFile.write(colors);
    expect(pal.length).toBe(64);
    expect([...pal.subarray(0, 4)]).toEqual([31 * 8, 8, 0, 0]);
    expect(PaletteFile.read(pal)).toEqual(colors);
    expect(() => PaletteFile.read(new Uint8Array(10))).toThrow(EditError);
    try {
      PaletteFile.write(new Array(16).fill(0), true);
    } catch (e) {
      expect((e as EditError).code).toBe(EditErrorCode.DuplicatePaletteColors);
    }
  });

  it("タイル指定と属性の分解", () => {
    expect(unpackTileRef(0x3c12)).toEqual({ tile: 0x12, hflip: true, vflip: true, palette: 3 });
    expect(attributeBytes(0x20000084)).toEqual([0x84, 0, 0, 0x20]);
    expect(attributeFromBytes([0x84, 0, 0, 0x20])).toBe(0x20000084);
    expect(unpackBlockAttribute(0x21000203)).toEqual({ behavior: 0x3, terrain: 1, encounterType: 1, layerType: 1 });
  });
});
