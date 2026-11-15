import { describe, expect, it } from "vitest";
import { CommandBus, EditErrorCode, EditError, SwapBlocksCommand, createDefaultRegistry, swapUnits, type TilesetRef } from "../src/index.js";
import { openLoaded, roundTrip, tilesetPrint } from "./helpers/editHarness.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();
const PRIMARY: TilesetRef = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
const SECONDARY: TilesetRef = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };
const MAPS = [
  { bank: 0, map: 0 },
  { bank: 0, map: 1 },
  { bank: 1, map: 0 },
];

/** 3 枚のマップの配置とボーダーに番号を置いて開く。 */
async function open() {
  const p = await openLoaded(rom, undefined, [PRIMARY, SECONDARY]);
  const ctx = p.editorContext();
  for (const id of MAPS) {
    ctx.document(id).grid.cells.set([0x281 | (1 << 10), 0x282, 5, 0x281]);
    ctx.border(id).cells.set([0x282, 0x282, 6, 5]);
  }
  const s = ctx.tileset(SECONDARY);
  s.blocks.set([1, 1, 1, 1, 1, 1, 1, 1], 1 * 8);
  s.blocks.set([2, 2, 2, 2, 2, 2, 2, 2], 2 * 8);
  s.attributes[1] = 0x11;
  s.attributes[2] = 0x22;
  return p;
}
const tilesets = (p: Awaited<ReturnType<typeof open>>) => tilesetPrint(p.editorContext(), [PRIMARY, SECONDARY]);

describe("SwapBlocksCommand（#394）", () => {
  it("副の 2 つを入れ替え、使うマップの配置とボーダーの番号も付け替える（見た目は同じ。1 回で戻る）", async () => {
    await roundTrip(
      open,
      () => SwapBlocksCommand.of(SECONDARY, 1, 2, MAPS),
      (p) => {
        const ctx = p.editorContext();
        const s = ctx.tileset(SECONDARY);
        expect([...s.blocks.subarray(8, 16)]).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
        expect([...s.blocks.subarray(16, 24)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
        expect([s.attributes[1], s.attributes[2]]).toEqual([0x22, 0x11]);
        for (const id of MAPS) {
          // 移動許可はそのまま、番号だけ付け替える
          expect([...ctx.document(id).grid.cells]).toEqual([0x282 | (1 << 10), 0x281, 5, 0x282]);
          expect([...ctx.border(id).cells]).toEqual([0x281, 0x281, 6, 5]);
        }
      },
      tilesets,
    );
  });

  it("付け替えないときはタイルセットの中だけ。別の副を使うマップは付け替えない", async () => {
    const p = await open();
    const ctx = p.editorContext();
    const bus = new CommandBus(ctx);
    bus.execute(SwapBlocksCommand.of(SECONDARY, 1, 2, []));
    expect([...ctx.document(MAPS[0]!).grid.cells]).toEqual([0x281 | (1 << 10), 0x282, 5, 0x281]);
    bus.undo();
    ctx.document(MAPS[2]!).secondaryTileset = 0x08123456;
    bus.execute(SwapBlocksCommand.of(SECONDARY, 1, 2, MAPS));
    expect(ctx.document(MAPS[0]!).grid.cells[1]).toBe(0x281);
    expect(ctx.document(MAPS[2]!).grid.cells[1]).toBe(0x282);
  });

  it("主のブロックは主が同じマップの番号を付け替える", async () => {
    const p = await open();
    const ctx = p.editorContext();
    const before = tilesetPrint(ctx, [SECONDARY]);
    new CommandBus(ctx).execute(SwapBlocksCommand.of(PRIMARY, 5, 6, MAPS));
    expect([...ctx.document(MAPS[1]!).grid.cells]).toEqual([0x281 | (1 << 10), 0x282, 6, 0x281]);
    expect([...ctx.border(MAPS[1]!).cells]).toEqual([0x282, 0x282, 5, 6]);
    expect(tilesetPrint(ctx, [SECONDARY])).toBe(before);
  });

  it("3 層のブロックは N と N+1 の組で動かす", async () => {
    const p = await open();
    const ctx = p.editorContext();
    const s = ctx.tileset(SECONDARY);
    s.attributes[1] = 0x30000000;
    s.attributes[4] = 0x30000000;
    s.blocks.set([7, 7, 7, 7, 0, 0, 0, 0], 5 * 8);
    expect(swapUnits(s, 1, 4)).toEqual({ from: [1, 2], to: [4, 5] });
    const bus = new CommandBus(ctx);
    bus.execute(SwapBlocksCommand.of(SECONDARY, 1, 4, MAPS));
    expect(s.attributes[4]).toBe(0x30000000);
    expect([...s.blocks.subarray(5 * 8, 6 * 8)]).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect([...s.blocks.subarray(2 * 8, 2 * 8 + 4)]).toEqual([7, 7, 7, 7]);
    // マップの 0x281・0x282 は 0x284・0x285 へ
    expect([...ctx.document(MAPS[0]!).grid.cells]).toEqual([0x284 | (1 << 10), 0x285, 5, 0x284]);
    bus.undo();
    expect([...ctx.document(MAPS[0]!).grid.cells]).toEqual([0x281 | (1 << 10), 0x282, 5, 0x281]);
    expect(s.attributes[1]).toBe(0x30000000);
  });

  it("組が崩れる入れ替えは止める（何も変えない）", async () => {
    const p = await open();
    const ctx = p.editorContext();
    const s = ctx.tileset(SECONDARY);
    s.attributes[1] = 0x30000000;
    const reason = (a: number, b: number) => {
      try {
        swapUnits(s, a, b);
        return null;
      } catch (e) {
        expect(e).toBeInstanceOf(EditError);
        expect((e as EditError).code).toBe(EditErrorCode.BlockSwapRefused);
        return (e as EditError).params["reason"];
      }
    };
    expect(reason(1, 4)).toBe("mixed");
    expect(reason(2, 4)).toBe("child");
    expect(reason(4, 2)).toBe("child");
    expect(reason(3, 3)).toBe("same");
    s.attributes[3] = 0x30000000;
    expect(reason(1, 3)).toBe(null);
    s.attributes[2] = 0x30000000;
    s.attributes[1] = 0;
    s.attributes[3] = 0;
    expect(reason(2, 3)).toBe("child");
    s.attributes[3] = 0;
    s.attributes[5] = 0x30000000;
    expect(reason(2, 5)).toBe(null);
    s.attributes[4] = 0x30000000;
    expect(reason(4, 5)).toBe("child");
    const last = s.blockCount - 1;
    s.attributes[last] = 0x30000000;
    expect(reason(last, 0)).toBe("noNext");
    const before = tilesets(p);
    expect(() => new CommandBus(ctx).execute(SwapBlocksCommand.of(SECONDARY, last, 0, MAPS))).toThrow(EditError);
    expect(tilesets(p)).toBe(before);
  });

  it("登録されていて JSON から作れる", () => {
    const c = createDefaultRegistry().create({ name: "swapBlocks", args: { tileset: SECONDARY.pointer, secondary: true, a: 1, b: 2, targets: [{ bank: 0, map: 0 }] } });
    expect(c).toBeInstanceOf(SwapBlocksCommand);
    expect(c.args["targets"]).toEqual([{ bank: 0, map: 0 }]);
  });
});
