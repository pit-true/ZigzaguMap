import { describe, expect, it } from "vitest";
import { CfruProject, CommandBus, MemoryProjectFs, PlaceBlockCommand, WARP_BEHAVIORS, isWarpBehavior } from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

describe("ワープとして働くブロックの挙動（#240）", () => {
  it("ドア・はしご・階段・エスカレーター・洞窟の出入り口・矢印は働く", () => {
    for (const b of [0x60, 0x61, 0x62, 0x65, 0x66, 0x67, 0x69, 0x6a, 0x6b, 0x6c, 0x6f, 0x71]) expect(isWarpBehavior(b)).toBe(true);
    expect(WARP_BEHAVIORS.get(0x69)).toBe("MB_WARP_DOOR");
  });
  it("草・床・水・0x70 は働かない。属性の上位ビットは見ない", () => {
    for (const b of [0x00, 0x02, 0x10, 0x70, 0x72, 0x5f]) expect(isWarpBehavior(b)).toBe(false);
    expect(isWarpBehavior(0x12340069)).toBe(true);
    expect(isWarpBehavior(0x00000200 | 0x02)).toBe(false);
  });
});

describe("CfruProject.peek（読み取り専用の読み込み）", () => {
  it("読み込み済みでなければ保持しない。読み込み済みなら編集中のものを返す", async () => {
    const project = await CfruProject.open(buildSyntheticRom(), new MemoryProjectFs());
    const id = { bank: 0, map: 1 };
    const peeked = await project.peek(id);
    expect(peeked?.width).toBe(2);
    expect(project.loaded(id)).toBeUndefined();
    const doc = await project.load(id);
    new CommandBus(project.gridStore()).execute(new PlaceBlockCommand({ ...id, x: 0, y: 0, block: 9 }));
    expect((await project.peek(id))?.grid.getBlock(0, 0)).toBe(9);
    expect(await project.peek(id)).toBe(doc);
  });
});
