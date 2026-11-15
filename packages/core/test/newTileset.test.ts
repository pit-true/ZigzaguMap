import { describe, expect, it } from "vitest";
import { CfruProject, CommandBus, MemoryProjectFs, TilesetSourceJson, newTilesetCommand, newTilesetContent, newTilesetLimits, type TilesetRef } from "../src/index.js";
import { openLoaded } from "./helpers/editHarness.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();
const PRIMARY: TilesetRef = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
const SECONDARY: TilesetRef = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };
const MAP = { bank: 0, map: 0 };

describe("新しいタイルセットの中身（#397）", () => {
  it("空は 0 で埋め、タイルは 16 の倍数に切り上げ、数は上限に収める", () => {
    const c = newTilesetContent({ secondary: true, tileCount: 20, blockCount: 5, copyFrom: null, compressed: true });
    expect(c.tiles.length).toBe(32 * 32);
    expect(c.attributes.length).toBe(5);
    expect(c.blocks.length).toBe(40);
    expect([c.header[0], c.header[1]]).toEqual([1, 1]);
    expect(c.palettes.every((v) => v === 0)).toBe(true);
    const big = newTilesetContent({ secondary: true, tileCount: 9999, blockCount: 9999, copyFrom: null, compressed: false });
    expect(big.tiles.length / 32).toBe(newTilesetLimits(true).tiles);
    expect(big.attributes.length).toBe(newTilesetLimits(true).blocks);
    expect(newTilesetContent({ secondary: false, tileCount: 0, blockCount: 0, copyFrom: null, compressed: false }).attributes.length).toBe(1);
  });
  it("写しは中身・パレット・ヘッダー（アニメの処理の位置）を使い、数に合わせて切る", () => {
    const header = new Uint8Array(24);
    header[0x10] = 0x99;
    const src = {
      header,
      compressed: false,
      tiles: new Uint8Array(64 * 32).fill(7),
      palettes: new Uint16Array(256).fill(0x1234),
      blocks: new Uint16Array(10 * 8).fill(3),
      attributes: new Uint32Array(10).fill(0x11),
    };
    const c = newTilesetContent({ secondary: false, tileCount: 16, blockCount: 12, copyFrom: src, compressed: true });
    expect(c.compressed).toBe(false);
    expect(c.header[0x10]).toBe(0x99);
    expect(c.tiles.length).toBe(16 * 32);
    expect(c.tiles.every((v) => v === 7)).toBe(true);
    expect([...c.attributes]).toEqual([...Array(10).fill(0x11), 0, 0]);
    expect(c.palettes[255]).toBe(0x1234);
  });
});

describe("新しいタイルセットのコマンド（#397）", () => {
  it("加えて組を付け替え、1 回で戻る。出力して読み直すと同じ", async () => {
    const fs = new MemoryProjectFs();
    const project = await openLoaded(rom, fs, [PRIMARY, SECONDARY]);
    const ctx = project.editorContext();
    const oldSecondary = ctx.document(MAP).secondaryTileset;
    const r = newTilesetCommand(ctx, { target: MAP, secondary: true, tileCount: 32, blockCount: 8, copy: false });
    const bus = new CommandBus(ctx);
    bus.execute(r.command);
    expect(ctx.document(MAP).secondaryTileset).toBe(r.pointer);
    const added = ctx.tileset({ pointer: r.pointer, secondary: true });
    expect(added.isNew).toBe(true);
    expect(added.blockCount).toBe(8);
    expect(added.tileCount).toBe(32);
    // 描いてから出力する
    added.blocks.set([1, 2, 3, 4, 5, 6, 7, 8], 8);
    added.tiles.fill(0x21, 0, 32);
    const saved = await project.save();
    const info = saved.written.find((w) => /secondary_[0-9A-F]+\/tileset\.json$/.test(w) && w.includes(((r.pointer - 0x08000000) >>> 0).toString(16).toUpperCase()));
    expect(info).toBeDefined();
    const json = TilesetSourceJson.parse(await fs.readText(info!), info!);
    expect(json.isNew).toBe(true);
    expect(json.blockCount).toBe(8);

    // 読み直すと同じ中身
    const again = await CfruProject.open(rom, fs);
    await again.load(MAP);
    const doc = again.editorContext().document(MAP);
    expect(doc.secondaryTileset).toBe(r.pointer);
    const reloaded = await again.loadTilesetDocument({ pointer: r.pointer, secondary: true });
    expect([...reloaded.blocks.subarray(8, 16)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(reloaded.tiles.subarray(0, 32).every((v) => v === 0x21)).toBe(true);

    bus.undo();
    expect(ctx.document(MAP).secondaryTileset).toBe(oldSecondary);
    expect(() => ctx.tileset({ pointer: r.pointer, secondary: true })).toThrow();
  });
  it("今のタイルセットの写しで作れる", async () => {
    const project = await openLoaded(rom, undefined, [PRIMARY, SECONDARY]);
    const ctx = project.editorContext();
    const cur = ctx.tileset(SECONDARY);
    const r = newTilesetCommand(ctx, { target: MAP, secondary: true, tileCount: cur.tileCount, blockCount: cur.blockCount, copy: true });
    new CommandBus(ctx).execute(r.command);
    const added = ctx.tileset({ pointer: r.pointer, secondary: true });
    expect([...added.blocks]).toEqual([...cur.blocks]);
    expect([...added.palettes]).toEqual([...cur.palettes]);
  });
});
