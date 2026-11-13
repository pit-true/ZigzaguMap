import { describe, expect, it } from "vitest";
import {
  BvdFile,
  DataError,
  EditError,
  colorFromBgr555,
  colorFromChannels,
  colorFromRgb8,
  decodeTileImage,
  encodeIndexedPng,
  encodeTilesDib,
  formatColorHex,
  parseColorHex,
  tilesToPixels,
} from "../src/index.js";

/** 16 色（色 i は赤 i、緑 31-i、青 i/2）。 */
const COLORS = Array.from({ length: 16 }, (_, i) => i | ((31 - i) << 5) | ((i >> 1) << 10));

describe("ブロックデータ（.bvd）", () => {
  it("FR/LG の形（数 u32、定義 16 バイト、属性 4 バイト、末尾 FRLG）で書いて読み直せる", () => {
    const blocks = Uint16Array.from({ length: 3 * 8 }, (_, i) => i * 0x111);
    const attributes = Uint32Array.of(0x20000084, 0x01000002, 0);
    const bvd = BvdFile.write(blocks, attributes);
    expect(bvd.length).toBe(4 + 3 * 16 + 3 * 4 + 4);
    expect([...bvd.subarray(0, 4)]).toEqual([3, 0, 0, 0]);
    expect([...bvd.subarray(4, 8)]).toEqual([0x00, 0x00, 0x11, 0x01]);
    expect([...bvd.subarray(52, 56)]).toEqual([0x84, 0, 0, 0x20]);
    expect(new TextDecoder().decode(bvd.subarray(bvd.length - 4))).toBe("FRLG");
    const back = BvdFile.read(bvd, 384);
    expect(back.blocks).toEqual(blocks);
    expect(back.attributes).toEqual(attributes);
    expect(back.fromRse).toBe(false);
  });

  it("RSE の .bvd（属性 2 バイト）は挙動と重なりを移す", () => {
    const out = new Uint8Array(4 + 16 + 2 + 4);
    out[0] = 1;
    out[4] = 0x05;
    out[20] = 0x61;
    out[21] = 0x10;
    out.set([0x52, 0x53, 0x45, 0x20], 22);
    const back = BvdFile.read(out, 640);
    expect(back.fromRse).toBe(true);
    expect(back.blocks[0]).toBe(5);
    expect(back.attributes[0]).toBe(0x20000061);
  });

  it("形が違う・上限を超えるものは DataError", () => {
    const bvd = BvdFile.write(new Uint16Array(8 * 2), new Uint32Array(2));
    expect(() => BvdFile.read(bvd, 1)).toThrow(DataError);
    expect(() => BvdFile.read(bvd.subarray(0, bvd.length - 2), 640)).toThrow(DataError);
    const bad = bvd.slice();
    bad[bad.length - 1] = 0x58;
    expect(() => BvdFile.read(bad, 640)).toThrow(DataError);
    expect(() => BvdFile.read(new Uint8Array(4), 640)).toThrow(DataError);
  });
});

describe("タイルセットの画像（DIB と PNG）", () => {
  const tiles = Uint8Array.from({ length: 32 * 20 }, (_, i) => (i * 7 + (i >> 5)) & 0xff);

  it("24 ビットの DIB（横 128、下の行から、色は 8 倍）で書いて読み直すと同じタイル", () => {
    const dib = encodeTilesDib(tiles, COLORS, 32);
    expect(String.fromCharCode(dib[0]!, dib[1]!)).toBe("BM");
    const v = new DataView(dib.buffer);
    expect([v.getInt32(18, true), v.getInt32(22, true), v.getUint16(28, true)]).toEqual([128, 16, 24]);
    expect(dib.length).toBe(54 + 128 * 3 * 16);
    // 左上のピクセル（最後の行）は色 tiles[0] & 0xF = 0 → 赤 0、緑 31*8、青 0。
    const top = 54 + 15 * 128 * 3;
    expect([dib[top + 2], dib[top + 1], dib[top]]).toEqual([0, 248, 0]);
    const back = decodeTileImage(dib, COLORS);
    expect(back.tileCount).toBe(32);
    expect(back.tiles.subarray(0, tiles.length)).toEqual(tiles);
    expect([...back.tiles.subarray(tiles.length)].every((b) => b === 0)).toBe(true);
  });

  it("インデックス PNG（4bpp）は色番号をそのまま使う", () => {
    const image = tilesToPixels(tiles, 32);
    const png = encodeIndexedPng({ ...image, palette: new Uint8Array(48) }, 4);
    const back = decodeTileImage(png, COLORS);
    expect(back.tiles.subarray(0, tiles.length)).toEqual(tiles);
  });

  it("8 ビットの BMP で 16 以上の色番号は、画像のパレットの色から近い色にする", () => {
    // 8×8、全部色番号 200。パレット 200 は COLORS[5] の色。
    const width = 8;
    const height = 8;
    const out = new Uint8Array(54 + 1024 + width * height);
    const v = new DataView(out.buffer);
    out[0] = 0x42;
    out[1] = 0x4d;
    v.setUint32(10, 54 + 1024, true);
    v.setUint32(14, 40, true);
    v.setInt32(18, width, true);
    v.setInt32(22, -height, true);
    v.setUint16(26, 1, true);
    v.setUint16(28, 8, true);
    const c = COLORS[5]!;
    out.set([((c >> 10) & 31) * 8, ((c >> 5) & 31) * 8, (c & 31) * 8, 0], 54 + 200 * 4);
    out.fill(200, 54 + 1024);
    const back = decodeTileImage(out, COLORS);
    expect(back.tileCount).toBe(1);
    expect([...back.tiles].every((b) => b === 0x55)).toBe(true);
  });

  it("大きさが 8 の倍数でない・形式が違うものは DataError", () => {
    const png = encodeIndexedPng({ width: 4, height: 8, pixels: new Uint8Array(32), palette: new Uint8Array(48) }, 4);
    expect(() => decodeTileImage(png, COLORS)).toThrow(DataError);
    expect(() => decodeTileImage(new Uint8Array(100), COLORS)).toThrow(DataError);
  });
});

describe("パレットエディタの色", () => {
  it("15 ビットの値と赤・緑・青（AdvanceMap の例: 47F7 → 23/31/17）", () => {
    expect(colorFromBgr555(0x47f7)).toEqual({ red: 23, green: 31, blue: 17, value: 0x47f7 });
    expect(colorFromChannels(31, 10, 5).value).toBe(0x155f);
    expect(formatColorHex(0x155f)).toBe("155F");
    expect(formatColorHex(0x1f)).toBe("001F");
  });

  it("15bit to RGB: 16 進として読み、最上位ビットは無視、16 進でなければ '$ZZZZ' の整数エラー", () => {
    expect(parseColorHex("7FFF")).toEqual({ red: 31, green: 31, blue: 31, value: 0x7fff });
    expect(parseColorHex("8000").value).toBe(0);
    expect(parseColorHex("001f").red).toBe(31);
    try {
      parseColorHex("ZZZZ");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EditError);
      expect((e as EditError).params["text"]).toBe("$ZZZZ");
    }
  });

  it("スポイト: 拾った画面の色（8 ビット）を 15 ビットにしてスライダーの値にする", () => {
    // 画面の (255, 128, 7) → 赤 31、緑 16、青 0。
    const picked = colorFromRgb8(255, 128, 7);
    expect([picked.red, picked.green, picked.blue]).toEqual([31, 16, 0]);
    expect(picked.value).toBe(0x021f);
    // 8 倍した値（AdvanceMap の右の数字）から拾い直すと同じ値。
    expect(colorFromRgb8(184, 248, 136).value).toBe(0x47f7);
  });
});
