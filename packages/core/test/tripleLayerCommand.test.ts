import { describe, expect, it } from "vitest";
import {
  CommandBus,
  EditErrorCode,
  SetBlockCommand,
  SetBlockCountCommand,
  SetTripleLayerCommand,
  BvdFile,
  MemoryProjectFs,
  TilesetSourceJson,
  TripleLayerIndex,
  createDefaultRegistry,
  type TilesetRef,
} from "../src/index.js";
import { expectEditError, openLoaded, roundTrip, tilesetPrint } from "./helpers/editHarness.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();
const PRIMARY: TilesetRef = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
const SECONDARY: TilesetRef = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };
const open = () => openLoaded(rom, undefined, [PRIMARY, SECONDARY]);
const tilesets = (p: Awaited<ReturnType<typeof open>>) => tilesetPrint(p.editorContext(), [PRIMARY, SECONDARY]);
const P = { tileset: PRIMARY.pointer, secondary: false };
const S = { tileset: SECONDARY.pointer, secondary: true };

describe("SetTripleLayerCommand", () => {
  it("3 層にすると N を書き、N+1 の下層に 3 枚目、属性と上層を 0 にする（1 回で戻る）", async () => {
    const tiles = [1, 2, 3, 4, 5, 6, 7, 8];
    const third = [0x11, 0x12, 0x13, 0x14];
    await roundTrip(
      async () => {
        const p = await open();
        // N+1 に属性と上層を入れておく（片付けで消えるはず）
        const ts = p.editorContext().tileset(PRIMARY);
        ts.blocks.set([9, 9, 9, 9, 9, 9, 9, 9], 4 * 8);
        ts.attributes[4] = 0x20000084;
        return p;
      },
      () => new SetTripleLayerCommand({ ...P, block: 3, tiles, attribute: 0x30000002, third }),
      (p) => {
        const ts = p.editorContext().tileset(PRIMARY);
        expect([...ts.blocks.subarray(24, 32)]).toEqual(tiles);
        expect(ts.attributes[3]).toBe(0x30000002);
        expect([...ts.blocks.subarray(32, 40)]).toEqual([...third, 0, 0, 0, 0]);
        expect(ts.attributes[4]).toBe(0);
      },
      tilesets,
    );
  });

  it("3 層をやめるときは N+1 に触れない", async () => {
    const project = await open();
    const ts = project.editorContext().tileset(PRIMARY);
    ts.blocks.set([9, 9, 9, 9, 9, 9, 9, 9], 4 * 8);
    ts.attributes[4] = 0x84;
    ts.attributes[3] = 0x30000000;
    new CommandBus(project.editorContext()).execute(new SetTripleLayerCommand({ ...P, block: 3, attribute: 0, third: [1, 1, 1, 1] }));
    expect(ts.attributes[3]).toBe(0);
    expect([...ts.blocks.subarray(32, 40)]).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
    expect(ts.attributes[4]).toBe(0x84);
  });

  it("表の最後のブロックは 3 層にできない（主の最後・副の最後・setBlock・ブロック数を減らす）", async () => {
    const project = await open();
    const ctx = project.editorContext();
    const lastP = ctx.tileset(PRIMARY).blockCount - 1;
    const lastS = ctx.tileset(SECONDARY).blockCount - 1;
    expectEditError(project, new SetTripleLayerCommand({ ...P, block: lastP, attribute: 0x30000000 }), EditErrorCode.TripleLayerNoNext);
    expectEditError(project, new SetTripleLayerCommand({ ...S, block: lastS, attribute: 0x30000000 }), EditErrorCode.TripleLayerNoNext);
    expectEditError(project, new SetBlockCommand({ ...S, block: lastS, attribute: 0x30000000 }), EditErrorCode.TripleLayerNoNext);
    expectEditError(project, new SetTripleLayerCommand({ ...P, block: 0, attribute: 0x30000000, third: [1] }), EditErrorCode.InvalidRawBytes);
    ctx.tileset(SECONDARY).attributes[5] = 0x30000000;
    expectEditError(project, new SetBlockCountCommand({ ...S, count: 6 }), EditErrorCode.TripleLayerNoNext);
    // 3 層のブロックが最後にならない減らし方は通る
    new CommandBus(ctx).execute(new SetBlockCountCommand({ ...S, count: 7 }));
    expect(ctx.tileset(SECONDARY).blockCount).toBe(7);
  });

  it("登録されていて JSON から作れる", () => {
    const registry = createDefaultRegistry();
    expect(registry.names()).toContain("setTripleLayer");
    const cmd = registry.create({ name: "setTripleLayer", args: { ...P, block: 1, attribute: 0x30000000, third: [1, 2, 3, 4] } });
    expect(cmd.name).toBe("setTripleLayer");
  });
});

describe("トリプルレイヤーの往復（#317）", () => {
  it("3 層にして出力し、開き直しても同じ状態。tileset.json は Bochi の規則（N の 4 バイト目 0x30、N+1 の属性と上層 0）", async () => {
    const fs = new MemoryProjectFs();
    const project = await openLoaded(rom, fs, [PRIMARY, SECONDARY]);
    const ctx = project.editorContext();
    ctx.tileset(PRIMARY).blocks.set([9, 9, 9, 9, 9, 9, 9, 9], 4 * 8);
    ctx.tileset(PRIMARY).attributes[4] = 0x84;
    new CommandBus(ctx).execute(new SetTripleLayerCommand({ ...P, block: 3, tiles: [1, 2, 3, 4, 5, 6, 7, 8], attribute: 0x30000002, third: [0x11, 0x12, 0x13, 0x14] }));
    const saved = await project.save();
    const info = saved.written.find((w) => w.endsWith("tileset.json") && w.includes("primary"))!;
    const json = TilesetSourceJson.parse(await fs.readText(info), info);
    expect(json.behaviors[3 * 4 + 3]).toBe(0x30);
    expect([...json.behaviors.subarray(4 * 4, 5 * 4)]).toEqual([0, 0, 0, 0]);
    expect([...json.blocks.subarray(4 * 16, 5 * 16)]).toEqual([0x11, 0, 0x12, 0, 0x13, 0, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const reopened = await openLoaded(rom, fs, [PRIMARY, SECONDARY]);
    const a = ctx.tileset(PRIMARY);
    const b = reopened.editorContext().tileset(PRIMARY);
    expect([...b.attributes]).toEqual([...a.attributes]);
    expect([...b.blocks]).toEqual([...a.blocks]);
    const index = new TripleLayerIndex(b, reopened.editorContext().tileset(SECONDARY));
    expect(index.isTriple(3) && index.isTripleChild(4)).toBe(true);

    // .bvd の書き出しと読み込みでも残る
    const bvd = BvdFile.read(BvdFile.write(b.blocks, b.attributes), b.blockCapacity);
    expect(bvd.attributes[3]).toBe(0x30000002);
    expect([...bvd.blocks.subarray(32, 40)]).toEqual([0x11, 0x12, 0x13, 0x14, 0, 0, 0, 0]);
  });
});
