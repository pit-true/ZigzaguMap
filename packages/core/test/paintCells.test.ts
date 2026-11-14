import { describe, expect, it } from "vitest";
import { BlockGrid, CommandBus, PaintCellValuesCommand, createDefaultRegistry, type EditorContext } from "../src/index.js";

describe("PaintCellValuesCommand（paintCells）", () => {
  it("ブロックと移動許可を両方書き、1 回の取り消しで戻る。JSON から作り直せる", () => {
    const grid = new BlockGrid(3, 2, Uint16Array.from([1, 2, 3, 4, 5, 6]));
    const context: EditorContext = { grid: () => grid };
    const bus = new CommandBus(context);
    const cmd = new PaintCellValuesCommand({
      bank: 3,
      map: 0,
      cells: [
        { x: 0, y: 0, block: 0x10, movement: 1 },
        { x: 2, y: 1, block: 0x3ff, movement: 0x3f },
      ],
    });
    bus.execute(cmd);
    expect(grid.getBlock(0, 0)).toBe(0x10);
    expect(grid.getMovement(0, 0)).toBe(1);
    expect(grid.getCell(2, 1)).toBe(0xffff);
    bus.undo();
    expect([...grid.cells]).toEqual([1, 2, 3, 4, 5, 6]);
    const again = createDefaultRegistry().create(JSON.parse(JSON.stringify({ name: cmd.name, args: cmd.args })));
    new CommandBus(context).execute(again);
    expect(grid.getCell(0, 0)).toBe((1 << 10) | 0x10);
  });

  it("ドラッグ中の後続をまとめ、範囲外は何も書かない", () => {
    const grid = new BlockGrid(2, 1);
    const bus = new CommandBus({ grid: () => grid });
    bus.execute(new PaintCellValuesCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 1, movement: 2 }] }));
    bus.execute(new PaintCellValuesCommand({ bank: 0, map: 0, cells: [{ x: 1, y: 0, block: 3, movement: 4 }] }), { merge: true });
    expect(bus.history()).toHaveLength(1);
    expect(bus.history()[0]!.args).toEqual({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 1, movement: 2 }, { x: 1, y: 0, block: 3, movement: 4 }] });
    bus.undo();
    expect([...grid.cells]).toEqual([0, 0]);
    expect(() => bus.execute(new PaintCellValuesCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 1, movement: 1 }, { x: 5, y: 0, block: 1, movement: 1 }] }))).toThrow(RangeError);
    expect([...grid.cells]).toEqual([0, 0]);
    expect(() => new PaintCellValuesCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 0x400, movement: 0 }] })).toThrow(RangeError);
    expect(() => new PaintCellValuesCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 0, movement: 0x40 }] })).toThrow(RangeError);
  });
});
