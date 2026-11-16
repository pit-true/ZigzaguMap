import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  ImportError,
  TRANSPARENT,
  TileDeduper,
  assignPalettes,
  colorSet,
  crc32,
  decodeRgbaPng,
  flipIndices,
  indexTile,
  medianCut,
  packTile,
  prepareImportLayers,
  reduceToFit,
  splitTiles,
  type PaletteSlotInput,
} from "../src/index.js";

// ---- テスト用の PNG（色の種類・ビット深度・フィルターを選べる） ----

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 行ごとのバイト列（フィルター前）から PNG を作る。`filter` は全行に同じものを使う。 */
function makePng(width: number, height: number, colorType: number, depth: number, rows: Uint8Array[], filter = 0, extra: [string, Uint8Array][] = []): Uint8Array {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]!;
  const bpp = Math.max(1, (channels * depth) >> 3);
  const raw: number[] = [];
  rows.forEach((row, y) => {
    raw.push(filter);
    const prev = y > 0 ? rows[y - 1]! : null;
    for (let x = 0; x < row.length; x++) {
      const a = x >= bpp ? row[x - bpp]! : 0;
      const b = prev ? prev[x]! : 0;
      const c = prev && x >= bpp ? prev[x - bpp]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]!;
      raw.push((row[x]! - pred) & 0xff);
    }
  });
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra.map(([t, d]) => chunk(t, d)), chunk("IDAT", new Uint8Array(deflateSync(Uint8Array.from(raw)))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 2×2 の RGBA の見本: 赤・半透明の緑・青・白。 */
const SAMPLE = [
  [255, 0, 0, 255],
  [0, 255, 0, 100],
  [0, 0, 255, 255],
  [255, 255, 255, 255],
];

describe("フルカラー PNG の読み込み（#440）", () => {
  for (const filter of [0, 1, 2, 3, 4]) {
    it(`RGBA 8 ビット、フィルター ${filter}`, () => {
      const rows = [Uint8Array.from([...SAMPLE[0]!, ...SAMPLE[1]!]), Uint8Array.from([...SAMPLE[2]!, ...SAMPLE[3]!])];
      const img = decodeRgbaPng(makePng(2, 2, 6, 8, rows, filter));
      expect([...img.rgba]).toEqual(SAMPLE.flat());
    });
  }

  it("RGB 8 ビットと tRNS の透明色", () => {
    const rows = [Uint8Array.from([255, 0, 0, 0, 255, 0]), Uint8Array.from([0, 0, 255, 255, 255, 255])];
    const img = decodeRgbaPng(makePng(2, 2, 2, 8, rows, 4, [["tRNS", Uint8Array.from([0, 0, 0, 255, 0, 0])]]));
    expect([...img.rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255]);
  });

  it("RGB 16 ビットは上位 8 ビット", () => {
    const rows = [Uint8Array.from([0x12, 0x34, 0xab, 0xcd, 0xff, 0x00])];
    const img = decodeRgbaPng(makePng(1, 1, 2, 16, rows));
    expect([...img.rgba]).toEqual([0x12, 0xab, 0xff, 255]);
  });

  it("グレー＋アルファとグレー 4 ビット", () => {
    const ga = decodeRgbaPng(makePng(2, 1, 4, 8, [Uint8Array.from([10, 255, 200, 0])]));
    expect([...ga.rgba]).toEqual([10, 10, 10, 255, 200, 200, 200, 0]);
    const g4 = decodeRgbaPng(makePng(2, 1, 0, 4, [Uint8Array.from([0xf0])]));
    expect([...g4.rgba]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it("インデックスと tRNS のアルファ", () => {
    const plte = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const img = decodeRgbaPng(makePng(2, 1, 3, 8, [Uint8Array.from([0, 1])], 0, [["PLTE", plte], ["tRNS", Uint8Array.from([0])]]));
    expect([...img.rgba]).toEqual([1, 2, 3, 0, 4, 5, 6, 255]);
  });
});

/** 単色の RGBA 画像。 */
function solid(width: number, height: number, rgba: [number, number, number, number]): { width: number; height: number; rgba: Uint8Array } {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set(rgba, i * 4);
  return { width, height, rgba: out };
}

describe("色の面と分割（#440）", () => {
  it("5 ビットへ丸め、アルファ 128 未満と左上の色を透明にする", () => {
    const img = solid(16, 16, [255, 0, 255, 255]); // 左上（透明色）はマゼンタ
    img.rgba.set([0x0f, 0x17, 0xff, 255], 4); // (1,0) は 5 ビットで (1, 2, 31)
    img.rgba.set([0, 0, 0, 127], 8); // (2,0) はアルファで透明
    const l = prepareImportLayers([img]);
    expect(l.transparentColor).toBe(0x1f | (0x1f << 10));
    expect(l.layers[0]![0]).toBe(TRANSPARENT);
    expect(l.layers[0]![1]).toBe(1 | (2 << 5) | (31 << 10));
    expect(l.layers[0]![2]).toBe(TRANSPARENT);
    expect(l.padded).toBe(false);
  });

  it("透明色を指定でき、null なら使わない", () => {
    const img = solid(16, 16, [255, 255, 255, 255]);
    expect(prepareImportLayers([img], { transparent: null }).layers[0]![0]).toBe(0x7fff);
    expect(prepareImportLayers([img], { transparent: 0x7fff }).layers[0]![0]).toBe(TRANSPARENT);
  });

  it("16 の倍数でない大きさは右と下を透明で埋める", () => {
    const l = prepareImportLayers([solid(20, 9, [8, 8, 8, 255])], { transparent: null });
    expect([l.width, l.height, l.padded]).toEqual([32, 16, true]);
    expect(l.layers[0]![19]).toBe(0x0421);
    expect(l.layers[0]![20]).toBe(TRANSPARENT);
    expect(l.layers[0]![9 * 32]).toBe(TRANSPARENT);
    expect(splitTiles(l.layers[0]!, l.width, l.height)).toHaveLength(8);
  });

  it("枚数・大きさの誤り", () => {
    const a = solid(16, 16, [0, 0, 0, 255]);
    expect(() => prepareImportLayers([])).toThrow(ImportError);
    expect(() => prepareImportLayers([a, a, a, a])).toThrow(/3 枚/);
    expect(() => prepareImportLayers([a, solid(32, 16, [0, 0, 0, 255])])).toThrow(/大きさ/);
    expect(() => prepareImportLayers([solid(1040, 16, [0, 0, 0, 255])])).toThrow(/1024/);
  });
});

/** 色番号 64 個の見本（ばらばらの並び）。 */
function pattern(seed: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, i) => ((i * 7 + seed * 3 + (i >> 3)) % 15) + 1);
}

describe("重複の除去（#440）", () => {
  it("反転の 4 通りでまとめる", () => {
    const d = new TileDeduper([]);
    const p = pattern(1);
    expect(d.add(p)).toEqual({ existing: null, created: 0, hflip: false, vflip: false });
    expect(d.add(p)).toEqual({ existing: null, created: 0, hflip: false, vflip: false });
    expect(d.add(flipIndices(p, true, false))).toMatchObject({ created: 0, hflip: true, vflip: false });
    expect(d.add(flipIndices(p, false, true))).toMatchObject({ created: 0, hflip: false, vflip: true });
    expect(d.add(flipIndices(p, true, true))).toMatchObject({ created: 0, hflip: true, vflip: true });
    expect(d.stats).toEqual({ created: 1, reused: 0, merged: 1, flipped: 3 });
  });

  it("反転を使わない設定", () => {
    const d = new TileDeduper([], { useFlip: false });
    d.add(pattern(1));
    expect(d.add(flipIndices(pattern(1), true, false)).created).toBe(1);
  });

  it("主のタイルを使い回し、副のタイルより先に見る", () => {
    const p = packTile(pattern(2));
    const primary = new Uint8Array(32 * 4);
    primary.set(p, 32 * 3);
    const secondary = new Uint8Array(32 * 2);
    secondary.set(p, 32);
    const d = new TileDeduper([
      { base: 0, tiles: primary },
      { base: 0x280, tiles: secondary },
    ]);
    expect(d.add(pattern(2))).toMatchObject({ existing: 3, created: null });
    expect(d.add(flipIndices(pattern(2), true, true))).toMatchObject({ existing: 3, hflip: true, vflip: true });
    expect(d.stats.reused).toBe(1);
    expect([...d.usedExisting]).toEqual([3]);
  });

  it("使い回しを切ると今あるタイルを見ない。skip の番号も見ない", () => {
    const tiles = new Uint8Array(64);
    expect(new TileDeduper([{ base: 0, tiles }], { reuseExisting: false }).add(new Uint8Array(64)).created).toBe(0);
    expect(new TileDeduper([{ base: 0, tiles, skip: (l) => l === 0 }]).add(new Uint8Array(64)).existing).toBe(1);
  });
});

// ---- パレット ----

/** 色 `colors` を順に並べたタイル（64 画素を埋める）。 */
function tileOf(colors: readonly number[]): Uint16Array {
  return Uint16Array.from({ length: 64 }, (_, i) => colors[i % colors.length]!);
}

function slots(indices: readonly number[], free = true, colors: number[] = new Array(16).fill(0)): PaletteSlotInput[] {
  return indices.map((index) => ({ index, colors, free }));
}

const range = (from: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + i);

describe("パレットの割り当て（#441）", () => {
  it("色数ちょうど（15 色）は 1 本に収まる", () => {
    const a = assignPalettes([tileOf(range(1, 15))], slots([7, 8]));
    expect(a.ok).toBe(true);
    expect(a.opened).toEqual([7]);
    expect(a.tilePalettes[0]).toBe(7);
    expect(colorSet(a.palettes.get(7)!.subarray(1))).toEqual(range(1, 15));
  });

  it("1 タイルで 16 色は減色が要る", () => {
    const a = assignPalettes([tileOf(range(1, 16))], slots([7, 8]));
    expect(a.ok).toBe(false);
    expect(a.overColorTiles).toBe(1);
  });

  it("本を超える分は足りない数と本ごとのタイルの数を返す", () => {
    const tiles = [tileOf(range(1, 15)), tileOf(range(100, 15)), tileOf(range(200, 15)), tileOf(range(200, 15))];
    const a = assignPalettes(tiles, slots([7, 8]));
    expect(a.ok).toBe(false);
    expect([a.needed, a.available]).toEqual([3, 2]);
    expect(a.groups.map((g) => g.tiles).sort()).toEqual([1, 1, 2]);
    expect(a.tilePalettes[2]).toBe(-2);
  });

  it("増える色が少ない本へまとめる", () => {
    const tiles = [tileOf(range(1, 10)), tileOf(range(100, 10)), tileOf(range(1, 5)), tileOf(range(101, 6))];
    const a = assignPalettes(tiles, slots([0, 1, 2]));
    expect(a.ok).toBe(true);
    expect(a.opened).toEqual([0, 1]);
    expect([...a.tilePalettes]).toEqual([0, 1, 0, 1]);
  });

  it("全部同じ色の絵は 1 本で 1 色", () => {
    const a = assignPalettes(new Array(20).fill(0).map(() => tileOf([0x1234])), slots([7]));
    expect(a.ok).toBe(true);
    expect(a.colorCount).toBe(1);
    expect(a.palettes.get(7)![1]).toBe(0x1234);
  });

  it("透明だけのタイルは本を使わない", () => {
    const a = assignPalettes([tileOf([TRANSPARENT])], slots([7]));
    expect(a.ok).toBe(true);
    expect(a.tilePalettes[0]).toBe(-1);
    expect(a.opened).toEqual([]);
  });

  it("今ある本（主の本など）が色を全部含めばそれを使い、色を書かない", () => {
    const primary = [0, ...range(50, 15)];
    const all: PaletteSlotInput[] = [{ index: 3, colors: primary, free: false }, ...slots([7])];
    const a = assignPalettes([tileOf([50, 51, 52]), tileOf([1, 2])], all);
    expect(a.ok).toBe(true);
    expect(a.fixedUsed).toEqual([3]);
    expect(a.tilePalettes[0]).toBe(3);
    expect(a.tilePalettes[1]).toBe(7);
    expect(a.palettes.has(3)).toBe(false);
  });

  it("0 番は今の色のまま。新しいタイルセットでは透明色を入れる", () => {
    const current = [0x7c1f, ...new Array(15).fill(0x1111)];
    const keep = assignPalettes([tileOf([5])], [{ index: 7, colors: current, free: true }]);
    expect(keep.palettes.get(7)![0]).toBe(0x7c1f);
    expect(keep.palettes.get(7)![2]).toBe(0x1111);
    const zero = assignPalettes([tileOf([5])], [{ index: 7, colors: current, free: true }], { zeroColor: 0x03e0 });
    expect(zero.palettes.get(7)![0]).toBe(0x03e0);
  });

  it("色番号は割り当てた本の番号（透明は 0）", () => {
    const tile = tileOf([TRANSPARENT, 9, 4]);
    const a = assignPalettes([tile], slots([7]));
    const idx = indexTile(tile, a.palettes.get(7)!);
    const pal = a.palettes.get(7)!;
    expect(idx[0]).toBe(0);
    expect(pal[idx[1]!]).toBe(9);
    expect(pal[idx[2]!]).toBe(4);
  });
});

describe("減色（#441）", () => {
  it("1 色超える絵を減らすと収まり、変わった画素を数える", () => {
    // 2 本 × 15 色 = 30 色に 31 色
    const tiles = [tileOf(range(1, 15)), tileOf(range(1000, 15)), tileOf([3000])];
    expect(assignPalettes(tiles, slots([7, 8])).ok).toBe(false);
    const r = reduceToFit(tiles, slots([7, 8]));
    expect(r.assignment.ok).toBe(true);
    expect(r.colorsBefore).toBe(31);
    expect(r.colorsAfter).toBeLessThanOrEqual(30);
    expect(r.changedPixels).toBeGreaterThan(0);
    expect(tiles[2]![0]).toBe(3000); // 入力は変えない
  });

  it("1 タイルで 64 色でも 15 色に減らす", () => {
    const tile = Uint16Array.from({ length: 64 }, (_, i) => (i % 32) | ((i >> 1) << 5));
    const r = reduceToFit([tile], slots([7]));
    expect(r.assignment.ok).toBe(true);
    expect(colorSet(r.tiles[0]!).length).toBeLessThanOrEqual(15);
  });

  it("写真のような絵（タイルごとに色がばらばら）も本の数に収める", () => {
    let x = 7;
    const rnd = (): number => (x = (x * 1103515245 + 12345) >>> 0) >>> 17;
    const tiles = Array.from({ length: 256 }, () => Uint16Array.from({ length: 64 }, () => rnd() & 0x7fff));
    const r = reduceToFit(tiles, slots(range(7, 6)));
    expect(r.assignment.ok).toBe(true);
    expect(r.assignment.opened.length).toBeLessThanOrEqual(6);
    for (const [i, t] of r.tiles.entries()) {
      const pal = r.assignment.palettes.get(r.assignment.tilePalettes[i]!)!;
      expect(() => indexTile(t, pal)).not.toThrow();
    }
  });

  it("空きの本が無ければ今ある本のいちばん近い色で描く", () => {
    const fixed: PaletteSlotInput[] = [{ index: 2, colors: [0, ...range(0, 15).map((i) => i * 2)], free: false }];
    const r = reduceToFit([tileOf([1, 3, 5])], fixed);
    expect(r.assignment.ok).toBe(true);
    expect(r.assignment.tilePalettes[0]).toBe(2);
  });

  it("透明は減色で変えない", () => {
    const tile = tileOf([TRANSPARENT, ...range(1, 20)]);
    const r = reduceToFit([tile], slots([7]));
    expect(r.tiles[0]![0]).toBe(TRANSPARENT);
  });

  it("メディアンカットは色が少なければそのまま、多ければ k 色以下", () => {
    const w = new Map(range(1, 40).map((c) => [c, c] as [number, number]));
    expect(medianCut(new Map([[5, 1]]), 15)).toEqual([5]);
    const out = medianCut(w, 15);
    expect(out.length).toBeLessThanOrEqual(15);
    expect(medianCut(w, 15)).toEqual(out);
  });
});
