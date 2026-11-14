import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BlockUsage, CfruProject, CommandBus, MemoryProjectFs, PaintMovementCommand, PlaceBlockCommand, layoutOf } from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const P = 0x08100000;
const S = 0x08200000;
const S2 = 0x08300000;
const cell = (block: number, movement: number) => block | (movement << 10);

describe("ブロックの使用回数（#235）", () => {
  it("主のブロックは主が同じマップ、副のブロックは組が同じマップで数える。いちばん多い移動許可", () => {
    const u = new BlockUsage();
    u.set({ id: { bank: 0, map: 0 }, primary: P, secondary: S, cells: Uint16Array.from([cell(5, 1), cell(5, 1), cell(5, 1), cell(5, 0), cell(0x281, 4)]), layoutKey: "a" });
    u.set({ id: { bank: 0, map: 1 }, primary: P, secondary: S2, cells: Uint16Array.from([cell(5, 0), cell(0x281, 1)]), layoutKey: "b" });
    expect(u.count(5, P, S)).toBe(5);
    expect(u.count(5, P, S2)).toBe(5);
    expect(u.mostMovement(5, P, S)).toBe(1);
    expect(u.count(0x281, P, S)).toBe(1);
    expect(u.count(0x281, P, S2)).toBe(1);
    expect(u.mostMovement(0x281, P, S)).toBe(4);
    expect(u.mostMovement(9, P, S)).toBeNull();
  });
  it("同じ配置は 1 回だけ数え、差し替え・外すと数え直す", () => {
    const u = new BlockUsage();
    const cells = Uint16Array.from([cell(7, 1)]);
    u.set({ id: { bank: 1, map: 0 }, primary: P, secondary: S, cells, layoutKey: "rom:100" });
    u.set({ id: { bank: 1, map: 1 }, primary: P, secondary: S, cells, layoutKey: "rom:100" });
    expect(u.count(7, P, S)).toBe(1);
    // 1.1 を編集した（自分の配置になる）
    u.set({ id: { bank: 1, map: 1 }, primary: P, secondary: S, cells: Uint16Array.from([cell(7, 1), cell(7, 2)]), layoutKey: "map:1.1" });
    expect(u.count(7, P, S)).toBe(3);
    u.remove({ bank: 1, map: 0 });
    expect(u.count(7, P, S)).toBe(2);
    u.remove({ bank: 1, map: 1 });
    expect(u.count(7, P, S)).toBe(0);
  });
  it("合成 ROM: 3 枚が共有する配置は 1 回。編集したマップは別に数える", async () => {
    const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
    const u = await BlockUsage.build(project);
    expect(u.size).toBe(3);
    const doc = await project.load({ bank: 0, map: 0 });
    const total = (b: number) => u.count(b, doc.primaryTileset, doc.secondaryTileset);
    const counts = new Map<number, number>();
    for (const v of doc.grid.cells) counts.set(v & 0x3ff, (counts.get(v & 0x3ff) ?? 0) + 1);
    for (const [b, n] of counts) expect(total(b)).toBe(n);
    const bus = new CommandBus(project.gridStore());
    bus.execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 0, block: 9 }));
    bus.execute(new PaintMovementCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, movement: 3 }] }));
    u.set(layoutOf(doc));
    expect(u.count(9, doc.primaryTileset, doc.secondaryTileset)).toBe(1);
    expect(u.mostMovement(9, doc.primaryTileset, doc.secondaryTileset)).toBe(3);
  });
});

const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("ブロックの使用回数（素の BPRJ）", () => {
  it("マサラタウンの左の木のブロックは、いちばん多い移動許可が壁（1）で、数が全マップを数えた値と合う", async () => {
    const project = await CfruProject.open(new Uint8Array(readFileSync(romPath!)), new MemoryProjectFs());
    const u = await BlockUsage.build(project);
    const pallet = await project.load({ bank: 3, map: 0 });
    const tree = pallet.grid.getBlock(0, 5);
    expect(u.mostMovement(tree, pallet.primaryTileset, pallet.secondaryTileset)).toBe(1);
    // 数え直す: 主が同じで、配置（フッター）が違うマップを 1 回ずつ
    const seen = new Set<number>();
    let n = 0;
    for (const id of project.mapIds()) {
      const footer = project.base.rom.pointer(project.base.bankTable.headerOffset(id));
      if (seen.has(footer)) continue;
      seen.add(footer);
      const doc = await project.peek(id);
      if (!doc || doc.primaryTileset >>> 0 !== pallet.primaryTileset >>> 0) continue;
      for (const v of doc.grid.cells) if ((v & 0x3ff) === tree) n++;
    }
    expect(u.count(tree, pallet.primaryTileset, pallet.secondaryTileset)).toBe(n);
    expect(n).toBeGreaterThan(1000);
  });
});
