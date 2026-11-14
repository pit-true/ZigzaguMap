import { describe, expect, it } from "vitest";
import { BlockGrid, CommandBus, CommandGroup, PaintBlocksCommand, affectedMaps, mapTargets, type EditorContext, type MapId } from "../src/index.js";

describe("affectedMaps", () => {
  it("1 つのコマンドの bank・map", () => {
    expect(affectedMaps({ name: "paintBlocks", args: { bank: 3, map: 0, cells: [] } })).toEqual([{ bank: 3, map: 0 }]);
  });

  it("マップを持たないコマンドは空", () => {
    expect(affectedMaps({ name: "setTilesetHeader", args: { tileset: 1 } })).toEqual([]);
    expect(affectedMaps(null)).toEqual([]);
  });

  it("入れ子の group を平らにし、重なりを除く", () => {
    const record = {
      name: "group",
      args: {
        commands: [
          { name: "paintBlocks", args: { bank: 3, map: 0, cells: [] } },
          {
            name: "group",
            args: {
              commands: [
                { name: "paintBlocks", args: { bank: 3, map: 19, cells: [] } },
                { name: "paintBlocks", args: { bank: 3, map: 0, cells: [] } },
              ],
            },
          },
        ],
      },
    };
    expect(affectedMaps(record)).toEqual([
      { bank: 3, map: 0 },
      { bank: 3, map: 19 },
    ]);
  });

  it("targets の一覧も集める（形の違う要素は無視）", () => {
    const record = { name: "shiftConnection", args: { bank: 3, map: 0, index: 0, offset: 3, targets: [...mapTargets([{ bank: 3, map: 0 }, { bank: 3, map: 19 }]), { bank: "x" }, 5] } };
    expect(affectedMaps(record)).toEqual([
      { bank: 3, map: 0 },
      { bank: 3, map: 19 },
    ]);
  });

  it("2 枚のマップへの group を実行・取り消しすると両方が変わって戻る", () => {
    const grids = new Map<string, BlockGrid>([
      ["3.0", new BlockGrid(2, 2)],
      ["3.19", new BlockGrid(2, 2)],
    ]);
    const context: EditorContext = { grid: (id: MapId) => grids.get(`${id.bank}.${id.map}`)! };
    const bus = new CommandBus(context);
    const seen: MapId[][] = [];
    bus.subscribe((e) => seen.push(affectedMaps(e.command)));
    const group = CommandGroup.of([
      new PaintBlocksCommand({ bank: 3, map: 0, cells: [{ x: 0, y: 1, block: 7 }] }),
      new PaintBlocksCommand({ bank: 3, map: 19, cells: [{ x: 0, y: 0, block: 8 }] }),
    ]);
    // まとめた側は同じマップではないので bank・map を持たない（affectedMaps で中を見る）
    expect(group.args["bank"]).toBeUndefined();
    bus.execute(group);
    expect(grids.get("3.0")!.getBlock(0, 1)).toBe(7);
    expect(grids.get("3.19")!.getBlock(0, 0)).toBe(8);
    bus.undo();
    expect(grids.get("3.0")!.getBlock(0, 1)).toBe(0);
    expect(grids.get("3.19")!.getBlock(0, 0)).toBe(0);
    expect(seen).toEqual([
      [
        { bank: 3, map: 0 },
        { bank: 3, map: 19 },
      ],
      [
        { bank: 3, map: 0 },
        { bank: 3, map: 19 },
      ],
    ]);
  });

  it("まとめたもの同士をまとめる（境界をまたぐドラッグ。#234）。1 回の取り消しで両方戻る", () => {
    const grids = new Map<string, BlockGrid>([
      ["3.0", new BlockGrid(2, 2)],
      ["3.19", new BlockGrid(2, 2)],
    ]);
    const bus = new CommandBus({ grid: (id: MapId) => grids.get(`${id.bank}.${id.map}`)! });
    bus.execute(new CommandGroup([new PaintBlocksCommand({ bank: 3, map: 0, cells: [{ x: 0, y: 0, block: 1 }] })]));
    bus.execute(
      new CommandGroup([
        new PaintBlocksCommand({ bank: 3, map: 0, cells: [{ x: 1, y: 0, block: 2 }] }),
        new PaintBlocksCommand({ bank: 3, map: 19, cells: [{ x: 0, y: 1, block: 3 }] }),
      ]),
      { merge: true },
    );
    expect(bus.history()).toHaveLength(1);
    expect(affectedMaps(bus.history()[0])).toEqual([
      { bank: 3, map: 0 },
      { bank: 3, map: 19 },
    ]);
    bus.undo();
    expect([...grids.get("3.0")!.cells]).toEqual([0, 0, 0, 0]);
    expect([...grids.get("3.19")!.cells]).toEqual([0, 0, 0, 0]);
  });
});
