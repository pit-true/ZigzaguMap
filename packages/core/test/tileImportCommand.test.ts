import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CommandBus,
  MemoryProjectFs,
  TRANSPARENT,
  TilesetSourceJson,
  importStamp,
  prepareImport,
  type ImportLayers,
  type ImportTarget,
  type TilesetRef,
} from "../src/index.js";
import { openLoaded, tilesetPrint } from "./helpers/editHarness.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();
const PRIMARY: TilesetRef = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
const SECONDARY: TilesetRef = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };
const MAP = { bank: 0, map: 0 };

/** 32×16 の絵（左のマスは 3 色の縞、右のマスは透明と 1 色）。 */
function sample(): ImportLayers {
  const width = 32;
  const height = 16;
  const layer = Uint16Array.from({ length: width * height }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    if (x < 16) return [0x001f, 0x03e0, 0x7c00][(x + y) % 3]!;
    return y < 8 ? TRANSPARENT : 0x2108;
  });
  return { width, height, sourceWidth: width, sourceHeight: height, padded: false, transparentColor: null, layers: [layer] };
}

async function setup(fs = new MemoryProjectFs()): Promise<{ project: CfruProject; bus: CommandBus }> {
  const project = await openLoaded(rom, fs, [PRIMARY, SECONDARY]);
  return { project, bus: new CommandBus(project.editorContext()) };
}

function ctxOf(project: CfruProject) {
  const c = project.editorContext();
  const doc = c.document(MAP);
  return { map: MAP, primary: c.tileset({ pointer: doc.primaryTileset >>> 0, secondary: false }), secondary: c.tileset({ pointer: doc.secondaryTileset >>> 0, secondary: true }) };
}

describe("取り込みの命令（#443）", () => {
  for (const target of [
    { secondary: true, isNew: false },
    { secondary: false, isNew: false },
  ] as ImportTarget[]) {
    it(`${target.secondary ? "副" : "主"}へ書き、1 回で戻る`, async () => {
      const { project, bus } = await setup();
      const c = project.editorContext();
      const before = tilesetPrint(c, [PRIMARY, SECONDARY]);
      const { plan, result } = prepareImport(c, ctxOf(project), { layers: sample(), target });
      expect(plan.ok).toBe(true);
      bus.execute(result!.command);
      const t = c.tileset(target.secondary ? SECONDARY : PRIMARY);
      const local = plan.locals[0]!;
      expect([...t.blocks.subarray(local * 8, local * 8 + 8)]).toEqual([...plan.built[0]!.tiles]);
      expect(t.tileCount % 16).toBe(0);
      expect(tilesetPrint(c, [PRIMARY, SECONDARY])).not.toBe(before);
      bus.undo();
      expect(tilesetPrint(c, [PRIMARY, SECONDARY])).toBe(before);
    });
  }

  it("新しいタイルセットを作って組を付け替え、出力して読み直すと同じ。1 回で戻る", async () => {
    const fs = new MemoryProjectFs();
    const { project, bus } = await setup(fs);
    const c = project.editorContext();
    const old = c.document(MAP).secondaryTileset;
    const { plan, result } = prepareImport(c, ctxOf(project), { layers: sample(), target: { secondary: true, isNew: true } });
    expect(plan.ok).toBe(true);
    bus.execute(result!.command);
    expect(c.document(MAP).secondaryTileset).toBe(result!.pointer);
    const added = c.tileset({ pointer: result!.pointer, secondary: true });
    expect(added.isNew).toBe(true);
    expect(added.tileCount).toBe(16);
    const saved = await project.save();
    const info = saved.written.find((w) => /secondary_[0-9A-F]+\/tileset\.json$/.test(w) && w.includes(((result!.pointer - 0x08000000) >>> 0).toString(16).toUpperCase()));
    expect(info).toBeDefined();
    const json = TilesetSourceJson.parse(await fs.readText(info!), info!);
    expect(json.isNew).toBe(true);
    expect(json.tileCount % 16).toBe(0);
    const again = await CfruProject.open(rom, fs);
    await again.load(MAP);
    const reloaded = await again.loadTilesetDocument({ pointer: result!.pointer, secondary: true });
    expect([...reloaded.blocks]).toEqual([...added.blocks]);
    expect([...reloaded.tiles]).toEqual([...added.tiles]);
    expect([...reloaded.palettes.subarray(7 * 16, 13 * 16)]).toEqual([...added.palettes.subarray(7 * 16, 13 * 16)]);
    bus.undo();
    expect(c.document(MAP).secondaryTileset).toBe(old);
  });

  it("画像の並びのスタンプを作る（透明のマスは貼らない）", async () => {
    const { project } = await setup();
    const c = project.editorContext();
    const ctx = ctxOf(project);
    const layers = sample();
    layers.layers[0]!.fill(TRANSPARENT, 0, 0); // そのまま
    const { plan } = prepareImport(c, ctx, { layers, target: { secondary: true, isNew: false } });
    const stamp = importStamp("取り込み", plan, { primary: ctx.primary.pointer, secondary: ctx.secondary.pointer }, "2026-11-16T00:00:00Z");
    expect(stamp!.width).toBe(2);
    expect(stamp!.cells.filter((x) => x !== null)).toHaveLength(2);
    expect(stamp!.secondaryUsed).toBe(true);
    expect(stamp!.withMovements).toBe(false);
  });

  it("書けない計画ではコマンドを作らない", async () => {
    const { project } = await setup();
    const empty: ImportLayers = { ...sample(), layers: [new Uint16Array(32 * 16).fill(TRANSPARENT)] };
    const r = prepareImport(project.editorContext(), ctxOf(project), { layers: empty, target: { secondary: true, isNew: false } });
    expect(r.plan.ok).toBe(false);
    expect(r.plan.problems.some((p) => p.code === "noBlocks")).toBe(true);
    expect(r.result).toBeNull();
  });
});
