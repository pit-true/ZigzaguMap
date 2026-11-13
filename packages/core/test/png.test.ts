import { deflateRawSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CfruProject,
  DataError,
  MemoryProjectFs,
  TilesetSourceJson,
  decodeIndexedPng,
  encodeBase64,
  inflateRaw,
  inflateZlib,
  tilesetFolder,
} from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

function sample(length: number): Uint8Array {
  // 繰り返しと乱れを混ぜ、固定・動的ハフマンと後方参照が出るようにする。
  let x = 12345;
  return Uint8Array.from({ length }, (_, i) => {
    x = (x * 1103515245 + 12345) >>> 0;
    return i % 300 < 150 ? i & 7 : x >>> 24;
  });
}

describe("inflate", () => {
  it("node:zlib で圧縮したものを展開できる（各レベル）", () => {
    for (const length of [0, 1, 100, 5000, 70000]) {
      const data = sample(length);
      for (const level of [0, 1, 6, 9]) {
        expect(inflateZlib(new Uint8Array(deflateSync(data, { level })))).toEqual(data);
      }
      expect(inflateRaw(new Uint8Array(deflateRawSync(data, { strategy: 4 })))).toEqual(data); // 固定ハフマン
    }
  });

  it("壊れたデータは DataError", () => {
    expect(() => inflateZlib(Uint8Array.from([0x78]))).toThrow(DataError);
    expect(() => inflateZlib(Uint8Array.from([0x78, 0x9c, 0xff]))).toThrow(DataError);
  });
});

/** 4bpp インデックス PNG を作る（各行のフィルターを順に変える）。 */
function makePng(width: number, height: number, pixel: (x: number, y: number) => number): Uint8Array {
  const stride = width / 2;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x += 2) row[x / 2] = (pixel(x, y) << 4) | pixel(x + 1, y);
    rows.push(row);
  }
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    const cur = rows[y]!;
    const prev = y > 0 ? rows[y - 1]! : new Uint8Array(stride);
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const a = x > 0 ? cur[x - 1]! : 0;
      const b = prev[x]!;
      const c = x > 0 ? prev[x - 1]! : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, pr][filter]!;
      raw[y * (stride + 1) + 1 + x] = (cur[x]! - pred) & 0xff;
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out; // CRC は読み手が確かめないので 0 のまま
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 4;
  ihdr[9] = 3;
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", new Uint8Array(48)),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

const pixel = (x: number, y: number) => (x * 3 + y * 5 + ((x * y) >> 2)) & 15;

describe("PNG の読み取り", () => {
  it("4bpp インデックス PNG（全フィルター）を色番号で読む", () => {
    const image = decodeIndexedPng(makePng(128, 16, pixel));
    expect(image.width).toBe(128);
    expect(image.height).toBe(16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 128; x++) expect(image.pixels[y * 128 + x]).toBe(pixel(x, y));
  });

  it("PNG でなければ DataError", () => {
    expect(() => decodeIndexedPng(new Uint8Array(10))).toThrow(DataError);
  });
});

describe("maps\\tilesets の読み取り", () => {
  const tileCount = 32; // 16 枚 × 2 行
  const png = makePng(128, 16, pixel);
  const info = (headerAddress: number) =>
    JSON.stringify({
      Format: 1,
      HeaderAddress: headerAddress,
      Secondary: false,
      New: false,
      Header: encodeBase64(Uint8Array.from([1, 0, ...new Array(22).fill(0)])),
      TileCount: tileCount,
      BlockCount: 2,
      BlockBytes: 16,
      BehaviorBytes: 4,
      Compressed: true,
      ImageSha256: "",
      Palettes: encodeBase64(new Uint8Array(512).fill(0x11)),
      Blocks: encodeBase64(new Uint8Array(32).fill(2)),
      Behaviors: encodeBase64(Uint8Array.from([1, 0, 0, 0x20, 2, 0, 0, 0])),
    });

  it("tileset.json と tiles.png から Tileset を作る", () => {
    const tileset = TilesetSourceJson.toTileset(TilesetSourceJson.parse(info(0x123456)), png);
    expect(tileset.header.isCompressed).toBe(true);
    expect(tileset.tiles.length).toBe(tileCount * 32);
    // タイル 1 の左上 2 ピクセルは画像の (8,0) と (9,0)。
    expect(tileset.tiles[32]).toBe(pixel(8, 0) | (pixel(9, 0) << 4));
    // タイル 16 は 2 行目の先頭。
    expect(tileset.tiles[16 * 32]).toBe(pixel(0, 8) | (pixel(1, 8) << 4));
    expect(tileset.palettes[0]).toBe(0x1111);
    expect([...tileset.attributes]).toEqual([0x20000001, 2]);
  });

  it("CfruProject は maps\\tilesets を ROM より優先する", async () => {
    const fs = new MemoryProjectFs();
    const folder = tilesetFolder(0x55000, false);
    await fs.writeText(`${folder}/tileset.json`, info(0x55000));
    fs.writeBytes(`${folder}/tiles.png`, png);
    const project = await CfruProject.open(buildSyntheticRom(), fs);
    const fromJson = await project.loadTileset(0x08055000, false);
    expect(fromJson.tiles.length).toBe(tileCount * 32);
    const fromRom = await project.loadTileset(0x08055100, true);
    expect(fromRom.header.offset).toBe(0x55100);
  });

  it("形式が不正なら例外", () => {
    expect(() => TilesetSourceJson.parse('{"Format":1,"HeaderAddress":0}')).toThrow();
  });
});
