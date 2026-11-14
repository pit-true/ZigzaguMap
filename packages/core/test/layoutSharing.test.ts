import { describe, expect, it } from "vitest";
import { CfruProject, CommandBus, LayoutSharing, MemoryProjectFs, PlaceBlockCommand } from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

describe("配置を共有しているマップ（#228）", () => {
  it("ベース ROM でフッターが同じマップを数える（合成 ROM は 3 枚が同じフッター）", async () => {
    const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
    const sharing = LayoutSharing.build(project);
    expect(sharing.count({ bank: 0, map: 0 })).toBe(3);
    expect(sharing.mapsSharing({ bank: 1, map: 0 })).toEqual([
      { bank: 0, map: 0 },
      { bank: 0, map: 1 },
      { bank: 1, map: 0 },
    ]);
    expect(sharing.sharedGroupCount).toBe(1);
    expect(sharing.count({ bank: 9, map: 9 })).toBe(0);
  });

  it("フッターを変えたマップは別に数える", async () => {
    const rom = buildSyntheticRom();
    // 0.1 のヘッダーのフッターのポインタを、別の位置（同じ中身でなくてよい）へ向ける。
    const view = new DataView(rom.buffer);
    const bank0List = view.getUint32(view.getUint32(0x54b0c, true) - 0x08000000, true) - 0x08000000;
    const header01 = view.getUint32(bank0List + 4, true) - 0x08000000;
    view.setUint32(header01, view.getUint32(header01, true) + 0x100, true);
    const project = await CfruProject.open(rom, new MemoryProjectFs());
    const sharing = LayoutSharing.build(project);
    expect(sharing.count({ bank: 0, map: 0 })).toBe(2);
    expect(sharing.count({ bank: 0, map: 1 })).toBe(1);
  });

  it("出力して JSON になったマップは共有から外れる（ほかのマップは数え直す）", async () => {
    const fs = new MemoryProjectFs();
    const project = await CfruProject.open(buildSyntheticRom(), fs);
    await project.load({ bank: 0, map: 0 });
    new CommandBus(project.gridStore()).execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 0, block: 5 }));
    // 出力の前は ROM の数え方のまま。
    expect(LayoutSharing.build(project).count({ bank: 0, map: 1 })).toBe(3);
    await project.save();
    const after = LayoutSharing.build(project);
    expect(after.count({ bank: 0, map: 0 })).toBe(0);
    expect(after.count({ bank: 0, map: 1 })).toBe(2);
  });
});

const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("配置の共有（素の BPRJ）", () => {
  it("ポケモンセンターの中などを数える", async () => {
    const { readFileSync } = await import("node:fs");
    const project = await CfruProject.open(new Uint8Array(readFileSync(romPath!)), new MemoryProjectFs());
    const sharing = LayoutSharing.build(project);
    const groups = new Map<string, number>();
    for (const id of project.mapIds()) {
      const list = sharing.mapsSharing(id);
      if (list.length > 1) groups.set(`${list[0]!.bank}.${list[0]!.map}`, list.length);
    }
    // 素の BPRJ では 18 組（先頭のマップ → 枚数）。ポケモンセンターの 1F・2F は 5.4 と 5.5 の組。
    expect(sharing.sharedGroupCount).toBe(18);
    expect(groups.get("5.4")).toBe(17);
    expect(groups.get("5.5")).toBe(18);
  });
});
