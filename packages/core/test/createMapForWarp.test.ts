import { describe, expect, it } from "vitest";
import { AddEventCommand, CfruProject, CommandBus, MemoryProjectFs, SetEventFieldsCommand, createMapForWarp, findWarpSamples } from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

/** 合成 ROM: 0.0 のワープ 0 は (1,1)。0.1 の (1,1) にもワープを置いて 1.0 のワープ 0（(0,1)）へ向ける。 */
async function setup() {
  const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
  for (const id of [
    { bank: 0, map: 0 },
    { bank: 0, map: 1 },
    { bank: 1, map: 0 },
  ])
    await project.load(id);
  const bus = new CommandBus(project.editorContext());
  bus.execute(new AddEventCommand({ bank: 0, map: 1, kind: "warp", x: 1, y: 1 }));
  bus.execute(new SetEventFieldsCommand({ bank: 0, map: 1, kind: "warp", index: 0, fields: { bank: 1, map: 0, warpId: 0 } }));
  bus.execute(new AddEventCommand({ bank: 1, map: 0, kind: "warp", x: 0, y: 1 }));
  return { project, bus };
}

describe("ワープの行き先のマップを作る（#241）", () => {
  it("同じタイルセットで同じブロックに乗っているほかのワープの行き先を見本にする", async () => {
    const { project } = await setup();
    const samples = await findWarpSamples(project, { bank: 0, map: 0 }, 0);
    expect(samples).toEqual([
      expect.objectContaining({ source: { bank: 0, map: 1 }, sourceWarp: 0, map: { bank: 1, map: 0 }, width: 2, height: 2, entry: { x: 0, y: 1 } }),
    ]);
    // 見本の行き先のマップにワープが無ければ見本にしない
    expect(await findWarpSamples(project, { bank: 0, map: 1 }, 0)).toEqual([]);
  });

  it("見本の配置を写して作り、両側のワープを向け合う。1 回の取り消しで戻る", async () => {
    const { project, bus } = await setup();
    const [sample] = await findWarpSamples(project, { bank: 0, map: 0 }, 0);
    const sampleDoc = await project.load(sample!.map);
    const target = { bank: 1, map: 1 };
    bus.execute(createMapForWarp(project.editorContext(), { from: { bank: 0, map: 0 }, warpIndex: 0, target, sample: sample!, copyLayout: true }, sampleDoc));
    const made = project.loaded(target)!;
    expect([made.width, made.height]).toEqual([2, 2]);
    expect([...made.grid.cells]).toEqual([...sampleDoc.grid.cells]);
    expect(made.events?.warps).toEqual([expect.objectContaining({ x: 0, y: 1, bank: 0, map: 0, warpId: 0 })]);
    expect(project.loaded({ bank: 0, map: 0 })!.events!.warps[0]).toEqual(expect.objectContaining({ bank: 1, map: 1, warpId: 0 }));
    bus.undo();
    expect(project.loaded(target)).toBeUndefined();
    expect(project.loaded({ bank: 0, map: 0 })!.events!.warps[0]).toEqual(expect.objectContaining({ bank: 4, map: 3, warpId: 2 }));
  });

  it("見本が無ければ 9×9 でブロック 0、戻りのワープは下の辺の中央", async () => {
    const { project, bus } = await setup();
    const target = { bank: 2, map: 0 };
    bus.execute(createMapForWarp(project.editorContext(), { from: { bank: 0, map: 0 }, warpIndex: 0, target, sample: null, copyLayout: false }));
    const made = project.loaded(target)!;
    expect([made.width, made.height]).toEqual([9, 9]);
    expect(new Set(made.grid.cells)).toEqual(new Set([0x0c << 10]));
    expect(made.events?.warps[0]).toEqual(expect.objectContaining({ x: 4, y: 8, bank: 0, map: 0, warpId: 0 }));
    expect(made.primaryTileset).toBe(project.loaded({ bank: 0, map: 0 })!.primaryTileset);
  });
});
