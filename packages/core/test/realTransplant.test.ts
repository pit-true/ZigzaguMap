import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BPRJ_OFFSETS,
  BlockRenderer,
  Rom,
  TilesetDocument,
  TilesetTable,
  TransplantSource,
  convertTilesets,
  type SourceTileset,
  type Tileset,
} from "../src/index.js";

// ROM が要るテスト（手元だけ）。ZIGZAGU_TEST_ROM に素の BPRJ、ZIGZAGU_TEST_EMERALD にエメラルド（日本語版か英語版）。
const bprjPath = process.env.ZIGZAGU_TEST_ROM;
const emeraldPath = process.env.ZIGZAGU_TEST_EMERALD;
const hasBprj = !!bprjPath && existsSync(bprjPath);
const hasEmerald = !!emeraldPath && existsSync(emeraldPath);

function asTileset(t: { tiles: Uint8Array; palettes: Uint16Array; blocks: Uint16Array; attributes: Uint32Array; secondary: boolean }): Tileset {
  return {
    header: { offset: 0, isCompressed: false, isSecondary: t.secondary, tilesOffset: 0, palettesOffset: 0, blocksOffset: 0, callback: 0, attributesOffset: 0 },
    tiles: t.tiles,
    palettes: t.palettes,
    blocks: t.blocks,
    attributes: t.attributes,
  };
}

/** エメラルドの決まり（主のタイル・ブロック 512、主のパレット 6 本）でブロックを描く（BlockRenderer と同じ塗り方）。 */
function renderEmerald(p: SourceTileset, s: SourceTileset, block: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(16 * 16 * 4);
  const color = (pal: number, i: number): number => (pal < 6 ? p.palettes : s.palettes)[pal * 16 + i] ?? 0;
  const ch = (v: number): number => (v << 3) | (v >> 2);
  const rgb = (c: number): [number, number, number] => [ch(c & 0x1f), ch((c >> 5) & 0x1f), ch((c >> 10) & 0x1f)];
  const put = (o: number, c: number) => {
    const [r, g, b] = rgb(c);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  };
  for (let i = 0; i < 256; i++) put(i * 4, color(0, 0));
  const defs = block < 512 ? p.blocks : s.blocks;
  const base = (block < 512 ? block : block - 512) * 8;
  for (let k = 0; k < 8; k++) {
    const entry = defs[base + k]!;
    const tile = entry & 0x3ff;
    const pal = (entry >> 12) & 0xf;
    const tiles = tile < 512 ? p.tiles : s.tiles;
    const start = (tile < 512 ? tile : tile - 512) * 32;
    const missing = start + 32 > tiles.length;
    const opaque = k < 4;
    if (missing && !opaque) continue;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const byte = missing ? 0 : tiles[start + py * 4 + (px >> 1)]!;
        const index = px & 1 ? byte >> 4 : byte & 0xf;
        if (!opaque && (index === 0 || color(pal, index) === color(pal, 0))) continue;
        const dx = (k & 1) * 8 + (entry & 0x400 ? 7 - px : px);
        const dy = ((k >> 1) & 1) * 8 + (entry & 0x800 ? 7 - py : py);
        put((dy * 16 + dx) * 4, color(pal, index));
      }
    }
  }
  return out;
}

describe.skipIf(!hasBprj)("移植（素の BPRJ → 素の BPRJ）", () => {
  it("マップの一覧が読め、タイルセットを写すと元と同じ中身の新しいタイルセットになる", () => {
    const bytes = new Uint8Array(readFileSync(bprjPath!));
    const source = TransplantSource.open(bytes);
    expect(source.game.code).toBe("BPRJ");
    const maps = source.maps();
    expect(maps.length).toBeGreaterThan(400);
    const pallet = maps.find((m) => m.id.bank === 3 && m.id.map === 0)!;
    expect(pallet.name).toBe("マサラタウン");
    const rom = new Rom(bytes);
    const starts = TilesetTable.read(rom, BPRJ_OFFSETS).dataStarts(rom);
    for (const [pointer, secondary] of [
      [pallet.primary, false],
      [pallet.secondary, true],
    ] as const) {
      const original = TilesetDocument.fromRom(rom, { pointer, secondary }, starts);
      const p = source.tileset(pallet.primary, false);
      const s = source.tileset(pallet.secondary, true);
      const r = convertTilesets({ spec: source.game.spec, primary: p, secondary: s, parts: "both", layout: source.layout(pallet.id), keepCallback: () => true });
      const t = secondary ? r.secondary! : r.primary!;
      expect([...t.palettes]).toEqual([...original.palettes]);
      expect([...t.blocks]).toEqual([...original.blocks]);
      expect([...t.attributes]).toEqual([...original.attributes]);
      expect(t.tiles).toEqual(original.tiles);
      expect([...t.header]).toEqual([...original.header]);
    }
  });
});

describe.skipIf(!hasEmerald)("移植（エメラルド → FR）", () => {
  const bytes = hasEmerald ? new Uint8Array(readFileSync(emeraldPath!)) : new Uint8Array(0);

  it("全マップのタイルセットの組を変換でき、FR の上限に収まる", () => {
    const source = TransplantSource.open(bytes);
    expect(source.game.spec.family).toBe("emerald");
    const maps = source.maps();
    expect(maps.length).toBeGreaterThan(500);
    const pairs = new Map<string, (typeof maps)[number]>();
    for (const m of maps) pairs.set(`${m.primary}:${m.secondary}`, m);
    for (const m of pairs.values()) {
      const r = convertTilesets({
        spec: source.game.spec,
        primary: source.tileset(m.primary, false),
        secondary: source.tileset(m.secondary, true),
        parts: "both",
        layout: source.layout(m.id),
        keepCallback: () => false,
      });
      expect(r.primary!.attributes.length).toBeLessThanOrEqual(640);
      expect(r.secondary!.attributes.length).toBeLessThanOrEqual(384);
      expect(r.secondary!.tiles.length / 32).toBeLessThanOrEqual(384);
      expect(r.primary!.tiles.length / 32).toBeLessThanOrEqual(640);
    }
  });

  it("ミシロタウン（0.9）の全ブロックが、エメラルドの決まりで描いた絵と同じ（色とタイルの付け替え）", () => {
    const source = TransplantSource.open(bytes);
    const m = source.mapInfo({ bank: 0, map: 9 });
    const p = source.tileset(m.primary, false);
    const s = source.tileset(m.secondary, true);
    const r = convertTilesets({ spec: source.game.spec, primary: p, secondary: s, parts: "both", layout: source.layout(m.id), keepCallback: () => false });
    const renderer = new BlockRenderer(asTileset(r.primary!), asTileset(r.secondary!));
    let compared = 0;
    for (let b = 0; b < p.attributes.length; b++) {
      expect(renderer.render(b)).toEqual(renderEmerald(p, s, b));
      compared++;
    }
    for (let b = 0; b < s.attributes.length; b++) {
      expect(renderer.render(640 + b)).toEqual(renderEmerald(p, s, 512 + b));
      compared++;
    }
    expect(compared).toBeGreaterThan(500);
    // 配置のマスの付け替え（副は 512 → 640）
    const layout = source.layout(m.id);
    const cells = [...layout.blocks].map(r.cell);
    expect(cells.every((v, i) => ((layout.blocks[i]! & 0x3ff) < 512 ? v === layout.blocks[i] : v === layout.blocks[i]! + 128))).toBe(true);
  });
});

// ほかの元の ROM（FR 英語版・LG など）。ZIGZAGU_TEST_SOURCES にパスを「;」区切りで。
const otherSources = (process.env.ZIGZAGU_TEST_SOURCES ?? "").split(";").filter((p) => p && existsSync(p));

describe.skipIf(otherSources.length === 0)("移植の元にするほかの ROM", () => {
  it.each(otherSources)("%s のマップの一覧を読み、全部の組を変換できる", (path) => {
    const source = TransplantSource.open(new Uint8Array(readFileSync(path)));
    const maps = source.maps();
    expect(maps.length).toBeGreaterThan(400);
    if (source.game.japanese && source.game.spec.family === "frlg") expect(maps.some((m) => m.name === "マサラタウン")).toBe(true);
    const pairs = new Map<string, (typeof maps)[number]>();
    for (const m of maps) pairs.set(`${m.primary}:${m.secondary}`, m);
    for (const m of pairs.values()) {
      const r = convertTilesets({
        spec: source.game.spec,
        primary: source.tileset(m.primary, false),
        secondary: source.tileset(m.secondary, true),
        parts: "both",
        layout: source.layout(m.id),
        keepCallback: () => false,
      });
      expect(r.secondary!.attributes.length).toBeLessThanOrEqual(384);
    }
  });
});
