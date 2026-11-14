import { describe, expect, it } from "vitest";
import {
  CommandBus,
  EMERALD_SPEC,
  FRLG_SPEC,
  MemoryProjectFs,
  TilesetSourceJson,
  convertTilesets,
  emeraldAttributeToFr,
  transplantCommand,
  type SourceLayout,
  type SourceTileset,
  type TilesetRef,
} from "../src/index.js";
import { findCode } from "../src/transplant/SourceGame.js";
import { openLoaded } from "./helpers/editHarness.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

/** 作った元のタイルセット。 */
function source(secondary: boolean, tileCount: number, blockCount: number, init?: (t: SourceTileset) => void): SourceTileset {
  const t: SourceTileset = {
    pointer: secondary ? 0x08200000 : 0x08100000,
    secondary,
    compressed: true,
    callback: 0,
    tiles: new Uint8Array(tileCount * 32).map((_, i) => (i >> 5) & 0xff),
    palettes: new Uint16Array(256).map((_, i) => i),
    blocks: new Uint16Array(blockCount * 8),
    attributes: new Uint32Array(blockCount),
  };
  init?.(t);
  return t;
}

const layout = (blocks: number[], border = [0, 0, 0, 0]): SourceLayout => ({
  width: blocks.length,
  height: 1,
  blocks: Uint16Array.from(blocks),
  borderWidth: 2,
  borderHeight: 2,
  border: Uint16Array.from(border),
});

describe("エメラルドの属性を FR の属性にする", () => {
  it("挙動を引き直し、地形・野生・重ね方を付ける", () => {
    // 草（0x02）、重ね方 1（主人公の下）
    expect(emeraldAttributeToFr(0x1002).value).toBe(0x02 | (1 << 9) | (1 << 24) | (1 << 29));
    // 海（0x15）
    expect(emeraldAttributeToFr(0x0015).value).toBe(0x15 | (2 << 9) | (2 << 24));
    // 深い水域１（エメラルド 0x11 → FR 0x1A）
    expect(emeraldAttributeToFr(0x0011).value & 0x1ff).toBe(0x1a);
    // FR に無い（橋 0x70）→ 0 と一覧
    expect(emeraldAttributeToFr(0x0070)).toEqual({ value: 0, unknownBehavior: 0x70 });
  });
});

describe("タイルセットの変換", () => {
  it("FR から FR はそのまま写す（3 層のブロックも残す）", () => {
    const p = source(false, 40, 10, (t) => {
      t.blocks.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
      t.attributes[0] = 0x30000002;
    });
    const s = source(true, 20, 5);
    const r = convertTilesets({ spec: FRLG_SPEC, primary: p, secondary: s, parts: "both", layout: null, keepCallback: () => true });
    expect([...r.primary!.blocks]).toEqual([...p.blocks]);
    expect(r.primary!.attributes[0]).toBe(0x30000002);
    expect(r.primary!.tiles.length).toBe(48 * 32); // 16 の倍数に切り上げ
    expect(r.secondary!.header[1]).toBe(1);
    expect(r.cell(0x2a5)).toBe(0x2a5);
    expect(r.report.unknownBehaviors).toEqual([]);
  });

  it("アニメ処理は取り込み先に同じ処理があるときだけ残す", () => {
    const p = source(false, 16, 1, (t) => ((t as { callback: number }).callback = 0x080700c1));
    const s = source(true, 16, 1, (t) => ((t as { callback: number }).callback = 0x08070101));
    const r = convertTilesets({ spec: FRLG_SPEC, primary: p, secondary: s, parts: "both", layout: null, keepCallback: (c) => c === 0x080700c1 });
    expect(new DataView(r.primary!.header.buffer).getUint32(0x10, true)).toBe(0x080700c1);
    expect(new DataView(r.secondary!.header.buffer).getUint32(0x10, true)).toBe(0);
    expect(r.report.callbackKept).toEqual({ primary: true, secondary: false });
  });

  it("エメラルドから: 副のタイル番号を 512 → 640 にずらし、両方ならパレット 6 を主へ移す", () => {
    const p = source(false, 512, 4, (t) => t.blocks.set([0x0001, 0x5002, 0x6201, 0, 0, 0, 0, 0], 0));
    const s = source(true, 100, 3, (t) => {
      t.blocks.set([0x6200, 0x7205, 0xc263, 0, 0, 0, 0, 0], 0);
      t.attributes[0] = 0x1002;
      t.attributes[1] = 0x0070;
    });
    const r = convertTilesets({ spec: EMERALD_SPEC, primary: p, secondary: s, parts: "both", layout: null, keepCallback: () => true });
    // 主のタイル 0x201（エメラルドの副の 1 番）→ FR の 0x281
    expect(r.primary!.blocks[2]).toBe(0x6281);
    // 副: 0x200 → 0x280、パレットはそのまま（6 は主の 6 番に入る）
    expect([...r.secondary!.blocks.subarray(0, 3)]).toEqual([0x6280, 0x7285, 0xc2e3]);
    expect([...r.primary!.palettes.subarray(96, 112)]).toEqual([...s.palettes.subarray(96, 112)]);
    expect(r.secondary!.attributes[0]).toBe(emeraldAttributeToFr(0x1002).value);
    expect(r.report.unknownBehaviors).toEqual([0x70]);
    // 配置のブロック: 主はそのまま、副は 512 → 640
    expect(r.cell((3 << 10) | 0x201)).toBe((3 << 10) | 0x281);
    expect(r.cell(0x10)).toBe(0x10);
  });

  it("エメラルドから副だけ: パレット 6 を空いている副の番号へ動かす", () => {
    const p = source(false, 16, 1);
    // 副はパレット 6・7・8 だけを使う（9〜12 は空き）
    const s = source(true, 16, 3, (t) => t.blocks.set([0x6000, 0x7000, 0x8000, 0, 0, 0, 0, 0], 0));
    const r = convertTilesets({ spec: EMERALD_SPEC, primary: p, secondary: s, parts: "secondary", layout: null, keepCallback: () => true });
    expect(r.primary).toBeNull();
    expect(r.report.movedPalettes).toEqual([{ from: 6, to: 9 }]);
    expect([...r.secondary!.blocks.subarray(0, 3)]).toEqual([0x9000, 0x7000, 0x8000]);
    expect([...r.secondary!.palettes.subarray(9 * 16, 10 * 16)]).toEqual([...s.palettes.subarray(6 * 16, 7 * 16)]);
  });

  it("エメラルドから副だけで 7 本とも使うときは、似た色のパレットにまとめる", () => {
    const p = source(false, 16, 1);
    const s = source(true, 16, 7, (t) => {
      for (let i = 0; i < 7; i++) t.blocks[i * 8] = (6 + i) << 12;
      t.palettes.set(t.palettes.subarray(10 * 16, 11 * 16), 6 * 16); // 6 番は 10 番と同じ色
    });
    const r = convertTilesets({ spec: EMERALD_SPEC, primary: p, secondary: s, parts: "secondary", layout: null, keepCallback: () => true });
    expect(r.report.mergedPalettes).toEqual([{ from: 6, to: 10 }]);
    expect(r.secondary!.blocks[0]).toBe(0xa000);
  });

  it("エメラルドの副が FR の上限（384）を超えるときは、使われているブロックとタイルだけに詰める", () => {
    const p = source(false, 16, 1);
    const s = source(true, 500, 450, (t) => {
      t.blocks[400 * 8] = 0x200 + 450; // ブロック 400 はタイル 450
      t.blocks[10 * 8] = 0x200 + 3; // ブロック 10 はタイル 3
    });
    const r = convertTilesets({
      spec: EMERALD_SPEC,
      primary: p,
      secondary: s,
      parts: "secondary",
      layout: layout([512 + 400, 512 + 10, 5], [512 + 10, 0, 0, 0]),
      keepCallback: () => true,
    });
    expect(r.secondary!.attributes.length).toBe(2);
    expect(r.report.packedBlocks).toBe(2);
    expect(r.report.droppedBlocks).toBe(448);
    expect(r.cell(512 + 10)).toBe(640);
    expect(r.cell(512 + 400)).toBe(641);
    expect(r.cell(512 + 300)).toBe(0); // 捨てたブロック
    // タイル 3 → 0、タイル 450 → 1（詰めた順）
    expect(r.secondary!.blocks[0]! & 0x3ff).toBe(640);
    expect(r.secondary!.blocks[8]! & 0x3ff).toBe(641);
    expect(r.report.packedTiles).toBe(2);
    expect(r.secondary!.tiles.subarray(32, 64)).toEqual(s.tiles.subarray(450 * 32, 451 * 32));
  });
});

describe("取り込みのコマンド", () => {
  const rom = buildSyntheticRom();
  const PRIMARY: TilesetRef = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
  const SECONDARY: TilesetRef = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };

  it("新しいタイルセットを加えて組を付け替え、配置も写す。1 回で戻り、出力すると New のタイルセットになる", async () => {
    const fs = new MemoryProjectFs();
    const project = await openLoaded(rom, fs, [PRIMARY, SECONDARY]);
    const ctx = project.editorContext();
    const before = ctx.document({ bank: 0, map: 0 });
    const oldPrimary = before.primaryTileset;
    const p = source(false, 20, 3, (t) => t.blocks.set([1, 2, 3, 4, 5, 6, 7, 8], 8));
    const s = source(true, 20, 2);
    const conversion = convertTilesets({ spec: FRLG_SPEC, primary: p, secondary: s, parts: "both", layout: null, keepCallback: () => false });
    const cmd = transplantCommand(ctx, { target: { bank: 0, map: 0 }, conversion, layout: layout([1, 2, 641], [1, 1, 1, 1]) });
    const bus = new CommandBus(ctx);
    bus.execute(cmd);
    const doc = ctx.document({ bank: 0, map: 0 });
    expect(doc.primaryTileset).toBe(0x08000000 + 0x1f00000);
    expect(doc.secondaryTileset).toBe(0x08000000 + 0x1f00020);
    expect([...doc.grid.cells]).toEqual([1, 2, 641]);
    expect(doc.width).toBe(3);
    const added = ctx.tileset({ pointer: doc.primaryTileset, secondary: false });
    expect(added.isNew).toBe(true);
    expect([...added.blocks.subarray(8, 16)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const saved = await project.save();
    const info = saved.written.find((w) => w.endsWith("primary_1F00000/tileset.json"));
    expect(info).toBeDefined();
    const json = TilesetSourceJson.parse(await fs.readText(info!), info!);
    expect(json.isNew).toBe(true);
    expect(json.blockCount).toBe(3);

    // 1 回の取り消しで全部戻り、次の出力でファイルが消える
    bus.undo();
    expect(ctx.document({ bank: 0, map: 0 }).primaryTileset).toBe(oldPrimary);
    expect(() => ctx.tileset({ pointer: 0x08000000 + 0x1f00000, secondary: false })).toThrow();
    const again = await project.save();
    expect(again.removed).toContain("maps/tilesets/primary_1F00000/tileset.json");
    // やり直しても同じ位置に戻る
    bus.redo();
    expect(ctx.document({ bank: 0, map: 0 }).primaryTileset).toBe(0x08000000 + 0x1f00000);
  });

  it("2 バイト境界で機械語を探す", () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 2, 3]);
    expect(findCode(bytes, Uint8Array.from([2, 3]))).toBe(2);
  });
});
