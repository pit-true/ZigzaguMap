import { describe, expect, it } from "vitest";
import {
  BPRJ_OFFSETS,
  BlockGrid,
  CommandBus,
  GridStore,
  MapLoader,
  PlaceBlockCommand,
  PlaceMovementCommand,
  Rom,
  createDefaultRegistry,
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
    expect(registry.names()).toEqual(["placeBlock", "placeMovement"]);
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
