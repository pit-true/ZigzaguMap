import { describe, expect, it } from "vitest";
import {
  BPRJ_OFFSETS,
  BlockGrid,
  CommandBus,
  CommandGroup,
  GridStore,
  MapLoader,
  PaintBlocksCommand,
  PaintBorderCommand,
  PaintMovementCommand,
  PlaceBlockCommand,
  PlaceMovementCommand,
  Rom,
  createDefaultRegistry,
  flattenCommandRecords,
  type CommandEvent,
  type EditorContext,
} from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

function singleGridContext(grid: BlockGrid): EditorContext {
  return { grid: () => grid };
}

describe("BlockGrid", () => {
  it("ブロックと移動許可を別々に書き換える", () => {
    const grid = new BlockGrid(2, 1, Uint16Array.from([(3 << 10) | 5, 0]));
    grid.setBlock(0, 0, 0x3ff);
    expect(grid.getMovement(0, 0)).toBe(3);
    grid.setMovement(0, 0, 0x3f);
    expect(grid.getBlock(0, 0)).toBe(0x3ff);
    expect(grid.getCell(0, 0)).toBe(0xffff);
  });

  it("範囲外は RangeError", () => {
    const grid = new BlockGrid(1, 1);
    expect(() => grid.getCell(1, 0)).toThrow(RangeError);
    expect(() => grid.setBlock(0, 0, 0x400)).toThrow(RangeError);
    expect(() => grid.setMovement(0, 0, 0x40)).toThrow(RangeError);
  });
});

describe("CommandBus", () => {
  it("実行・アンドゥ・リドゥ・履歴", () => {
    const grid = new BlockGrid(2, 2, Uint16Array.from([(1 << 10) | 1, 2, 3, 4]));
    const bus = new CommandBus(singleGridContext(grid));
    expect(bus.canUndo).toBe(false);

    bus.execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 0, block: 9 }));
    bus.execute(new PlaceMovementCommand({ bank: 0, map: 0, x: 0, y: 0, movement: 0x0c }));
    expect(grid.getCell(0, 0)).toBe((0x0c << 10) | 9);
    expect(bus.history()).toEqual([
      { name: "placeBlock", args: { bank: 0, map: 0, x: 0, y: 0, block: 9 } },
      { name: "placeMovement", args: { bank: 0, map: 0, x: 0, y: 0, movement: 0x0c } },
    ]);

    expect(bus.undo()).toBe(true);
    expect(grid.getCell(0, 0)).toBe((1 << 10) | 9);
    expect(bus.undo()).toBe(true);
    expect(grid.getCell(0, 0)).toBe((1 << 10) | 1);
    expect(bus.undo()).toBe(false);

    expect(bus.redo()).toBe(true);
    expect(grid.getCell(0, 0)).toBe((1 << 10) | 9);
    expect(bus.canRedo).toBe(true);

    bus.execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 1, y: 1, block: 7 }));
    expect(bus.canRedo).toBe(false);
    expect(bus.history().length).toBe(2);
  });

  it("購読者に出来事を知らせ、解除できる", () => {
    const bus = new CommandBus(singleGridContext(new BlockGrid(1, 1)));
    const events: CommandEvent["type"][] = [];
    const off = bus.subscribe((e) => events.push(e.type));
    bus.execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 0, block: 1 }));
    bus.undo();
    bus.redo();
    bus.clear();
    off();
    bus.execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 0, block: 2 }));
    expect(events).toEqual(["execute", "undo", "redo", "clear"]);
  });

  it("失敗したコマンドは履歴に積まない", () => {
    const bus = new CommandBus(singleGridContext(new BlockGrid(1, 1)));
    expect(() => bus.execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 5, y: 0, block: 1 }))).toThrow(RangeError);
    expect(bus.canUndo).toBe(false);
  });
});

describe("CommandRegistry", () => {
  it("JSON の操作列を再生できる", () => {
    const registry = createDefaultRegistry();
    expect(registry.names().slice(0, 5)).toEqual(["placeBlock", "placeMovement", "paintBlocks", "paintMovement", "paintBorder"]);
    const grid = new BlockGrid(1, 1);
    const bus = new CommandBus(singleGridContext(grid));
    const script = JSON.parse(
      '[{"name":"placeBlock","args":{"bank":0,"map":0,"x":0,"y":0,"block":5}},' +
        '{"name":"placeMovement","args":{"bank":0,"map":0,"x":0,"y":0,"movement":1}}]',
    ) as { name: string; args: Record<string, unknown> }[];
    for (const record of script) bus.execute(registry.create(record));
    expect(grid.getCell(0, 0)).toBe((1 << 10) | 5);
    expect(JSON.stringify(bus.history())).toBe(JSON.stringify(script));
  });

  it("知らない名前や不正な引数はエラー", () => {
    const registry = createDefaultRegistry();
    expect(() => registry.create({ name: "nope", args: {} })).toThrow(Error);
    expect(() => registry.create({ name: "placeBlock", args: { bank: "0" } })).toThrow(TypeError);
  });
});

describe("GridStore", () => {
  it("ROM の配置をコピーして編集し、ROM は変えない", () => {
    const bytes = buildSyntheticRom();
    const loader = new MapLoader(new Rom(bytes), BPRJ_OFFSETS);
    const store = new GridStore(loader);
    const bus = new CommandBus(store);
    bus.execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 0, block: 3 }));
    expect(store.grid({ bank: 0, map: 0 }).getBlock(0, 0)).toBe(3);
    expect(loader.readLayout({ bank: 0, map: 0 }).blocks[0]).toBe(1);
    expect(store.has({ bank: 0, map: 1 })).toBe(false);
  });
});

describe("PaintBlocksCommand / PaintMovementCommand", () => {
  it("複数マスに置き、移動許可やブロック番号は変えない", () => {
    const grid = new BlockGrid(3, 1, Uint16Array.from([(1 << 10) | 1, (2 << 10) | 2, (3 << 10) | 3]));
    const bus = new CommandBus(singleGridContext(grid));
    bus.execute(new PaintBlocksCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 9 }, { x: 2, y: 0, block: 8 }] }));
    expect([...grid.cells]).toEqual([(1 << 10) | 9, (2 << 10) | 2, (3 << 10) | 8]);
    bus.execute(new PaintMovementCommand({ bank: 0, map: 0, cells: [{ x: 1, y: 0, movement: 0x0c }] }));
    expect(grid.getCell(1, 0)).toBe((0x0c << 10) | 2);
    bus.undo();
    bus.undo();
    expect([...grid.cells]).toEqual([(1 << 10) | 1, (2 << 10) | 2, (3 << 10) | 3]);
  });

  it("ドラッグ中の後続をまとめて 1 回で戻せ、まとめた引数で再生できる", () => {
    const grid = new BlockGrid(3, 1);
    const bus = new CommandBus(singleGridContext(grid));
    bus.execute(new PaintBlocksCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 1 }] }));
    bus.execute(new PaintBlocksCommand({ bank: 0, map: 0, cells: [{ x: 1, y: 0, block: 1 }] }), { merge: true });
    bus.execute(new PaintBlocksCommand({ bank: 0, map: 0, cells: [{ x: 1, y: 0, block: 2 }] }), { merge: true });
    expect(bus.history()).toEqual([
      {
        name: "paintBlocks",
        args: {
          bank: 0,
          map: 0,
          cells: [
            { x: 0, y: 0, block: 1 },
            { x: 1, y: 0, block: 1 },
            { x: 1, y: 0, block: 2 },
          ],
        },
      },
    ]);
    expect([...grid.cells]).toEqual([1, 2, 0]);
    bus.undo();
    expect([...grid.cells]).toEqual([0, 0, 0]);
    expect(bus.canUndo).toBe(false);
    bus.redo();
    expect([...grid.cells]).toEqual([1, 2, 0]);

    // 再生しても同じ結果になる。
    const replayed = new BlockGrid(3, 1);
    const registry = createDefaultRegistry();
    const other = new CommandBus(singleGridContext(replayed));
    for (const record of JSON.parse(JSON.stringify(bus.history()))) other.execute(registry.create(record));
    expect([...replayed.cells]).toEqual([1, 2, 0]);
  });

  it("種類やマップが違うとまとめない", () => {
    const grid = new BlockGrid(2, 1);
    const bus = new CommandBus(singleGridContext(grid));
    bus.execute(new PaintBlocksCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 1 }] }));
    bus.execute(new PaintMovementCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, movement: 1 }] }), { merge: true });
    bus.execute(new PaintBlocksCommand({ bank: 0, map: 1, cells: [{ x: 1, y: 0, block: 1 }] }), { merge: true });
    expect(bus.history().length).toBe(3);
  });

  it("範囲外を含むと何も書かずに失敗する", () => {
    const grid = new BlockGrid(1, 1);
    const bus = new CommandBus(singleGridContext(grid));
    const cells = [
      { x: 0, y: 0, block: 5 },
      { x: 3, y: 0, block: 5 },
    ];
    expect(() => bus.execute(new PaintBlocksCommand({ bank: 0, map: 0, cells }))).toThrow(RangeError);
    expect(grid.getCell(0, 0)).toBe(0);
    expect(bus.canUndo).toBe(false);
  });
});

describe("PaintBorderCommand", () => {
  it("ボーダーに置いて戻せる。ボーダーの無い EditorContext では失敗する", () => {
    const bytes = buildSyntheticRom();
    const loader = new MapLoader(new Rom(bytes), BPRJ_OFFSETS);
    const store = new GridStore(loader);
    const bus = new CommandBus(store);
    const id = { bank: 0, map: 0 };
    const before = store.border(id).getBlock(0, 0);
    bus.execute(new PaintBorderCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 0x123 }] }));
    expect(store.border(id).getBlock(0, 0)).toBe(0x123);
    bus.undo();
    expect(store.border(id).getBlock(0, 0)).toBe(before);
    expect(() => new CommandBus(singleGridContext(new BlockGrid(1, 1))).execute(
      new PaintBorderCommand({ bank: 0, map: 0, cells: [{ x: 0, y: 0, block: 1 }] }),
    )).toThrow(Error);
  });

  it("JSON の cells の形が違えば TypeError", () => {
    const registry = createDefaultRegistry();
    expect(() => registry.create({ name: "paintBlocks", args: { bank: 0, map: 0, cells: {} } })).toThrow(TypeError);
    expect(() => registry.create({ name: "paintMovement", args: { bank: 0, map: 0, cells: [{ x: 0, y: 0 }] } })).toThrow(TypeError);
  });
});

describe("CommandGroup", () => {
  it("1 回の操作として実行・アンドゥし、記録から作り直せる", () => {
    const grid = new BlockGrid(2, 1, Uint16Array.from([1, 2]));
    const bus = new CommandBus(singleGridContext(grid));
    const group = CommandGroup.of([
      new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 0, block: 7 }),
      new PlaceBlockCommand({ bank: 0, map: 0, x: 1, y: 0, block: 8 }),
    ]);
    bus.execute(group);
    expect([grid.getBlock(0, 0), grid.getBlock(1, 0)]).toEqual([7, 8]);
    expect(group.args["bank"]).toBe(0);
    bus.undo();
    expect([grid.getBlock(0, 0), grid.getBlock(1, 0)]).toEqual([1, 2]);

    // 履歴の記録（name: "group"）を、登録表から作り直して再生できる
    const record = JSON.parse(JSON.stringify({ name: group.name, args: group.args }));
    bus.execute(createDefaultRegistry().create(record));
    expect([grid.getBlock(0, 0), grid.getBlock(1, 0)]).toEqual([7, 8]);
    expect(flattenCommandRecords(record).map((r) => r.name)).toEqual(["group", "placeBlock", "placeBlock"]);
  });

  it("1 つだけならまとめない。途中で失敗したら実行した分を戻す", () => {
    const one = new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 0, block: 7 });
    expect(CommandGroup.of([one])).toBe(one);
    const grid = new BlockGrid(1, 1, Uint16Array.from([1]));
    const bad = new CommandGroup([one, new PlaceBlockCommand({ bank: 0, map: 0, x: 5, y: 0, block: 8 })]);
    expect(() => bad.do(singleGridContext(grid))).toThrow();
    expect(grid.getBlock(0, 0)).toBe(1);
  });
});
