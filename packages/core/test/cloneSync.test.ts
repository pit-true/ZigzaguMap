import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CloneSyncCommand,
  CommandBus,
  CommandGroup,
  MemoryProjectFs,
  MoveEventCommand,
  RemoveEventCommand,
  ResizeMapCommand,
  clonePosition,
  cloneTargetOf,
} from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const main = { bank: 0, map: 0 };
const up = { bank: 1, map: 0 };

/** 合成 ROM の 0.0（上へ 1.0 につながる。ずれ -2）を 20×20 にして、人 0 を (5, 3) に置く。 */
async function setup() {
  const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
  await project.load(main);
  await project.load(up);
  const bus = new CommandBus(project.editorContext());
  bus.execute(new ResizeMapCommand({ ...main, width: 20, height: 20 }));
  bus.execute(new MoveEventCommand({ ...main, kind: "person", index: 0, x: 5, y: 3 }));
  return { project, bus };
}

const sync = () => new CloneSyncCommand({ ...main, targets: [up] });

describe("クローンの自動作成（#242）", () => {
  it("境界から 8 マス以内ならクローンの位置、外なら null", () => {
    const n = { id: up, direction: 2, x: -2, y: -2, width: 2, height: 2 };
    expect(clonePosition({ width: 20, height: 20 }, n, { x: 5, y: 3 })).toEqual({ x: 7, y: 5 });
    expect(clonePosition({ width: 20, height: 20 }, n, { x: 5, y: 7 })).toEqual({ x: 7, y: 9 });
    expect(clonePosition({ width: 20, height: 20 }, n, { x: 5, y: 8 })).toBeNull();
    // 隣の横の範囲から大きく外れる
    expect(clonePosition({ width: 20, height: 20 }, n, { x: 19, y: 0 })).toBeNull();
  });

  it("作る・動かす・消すを 1 回の取り消しで戻せる", async () => {
    const { project, bus } = await setup();
    const person = project.loaded(main)!.events!.persons[0]!;
    bus.execute(CommandGroup.of([new MoveEventCommand({ ...main, kind: "person", index: 0, x: 5, y: 3 }), sync()]));
    const clones = () => project.loaded(up)!.events?.persons.filter((p) => cloneTargetOf(p)) ?? [];
    expect(clones()).toEqual([
      expect.objectContaining({ kind: 1, x: 7, y: 5, elevation: person.localId, trainerType: 0, trainerRangeOrBerryTree: 0, graphicsId: person.graphicsId, flag: person.flag }),
    ]);
    // 近いまま動かすと位置を合わせる
    bus.execute(CommandGroup.of([new MoveEventCommand({ ...main, kind: "person", index: 0, x: 6, y: 4 }), sync()]));
    expect(clones()).toEqual([expect.objectContaining({ x: 8, y: 6 })]);
    // 8 マスより外へ出ると消える
    bus.execute(CommandGroup.of([new MoveEventCommand({ ...main, kind: "person", index: 0, x: 6, y: 12 }), sync()]));
    expect(clones()).toEqual([]);
    bus.undo();
    expect(clones()).toEqual([expect.objectContaining({ x: 8, y: 6 })]);
    expect(project.loaded(main)!.events!.persons[0]).toEqual(expect.objectContaining({ x: 6, y: 4 }));
    // 元の人を消すとクローンも消える
    bus.execute(CommandGroup.of([new RemoveEventCommand({ ...main, kind: "person", index: 0 }), sync()]));
    expect(clones()).toEqual([]);
    bus.undo();
    expect(clones().length).toBe(1);
  });

  it("マップの外のクローンは「マップの外のイベント」に数えない", async () => {
    const { project, bus } = await setup();
    const { eventsOutsideMap } = await import("../src/index.js");
    bus.execute(CommandGroup.of([new MoveEventCommand({ ...main, kind: "person", index: 0, x: 5, y: 3 }), sync()]));
    const neighbor = project.loaded(up)!;
    expect(neighbor.events!.persons.some((p) => p.kind === 1 && p.y >= neighbor.height)).toBe(true);
    expect(eventsOutsideMap(neighbor).filter((e) => e.kind === "person" && neighbor.events!.persons[e.index]!.kind === 1)).toEqual([]);
  });

  it("記録から変わったマップに隣のマップも入る（描き直しと未出力の印）", async () => {
    const { affectedMaps } = await import("../src/index.js");
    expect(affectedMaps({ name: "syncClones", args: { ...main, targets: [up] } })).toEqual([main, up]);
  });
});
