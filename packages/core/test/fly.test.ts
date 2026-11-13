import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CommandBus,
  DocumentStore,
  EditError,
  MemoryProjectFs,
  SetFlyPositionCommand,
  createDefaultRegistry,
  findFlyPosition,
  flyPositionCodec,
} from "../src/index.js";

describe("フライトポジション", () => {
  it("8 バイトを読み書きする", () => {
    const bytes = Uint8Array.of(3, 1, 0x1a, 0, 0x1b, 0, 0x34, 0x12);
    const p = flyPositionCodec.decode(bytes);
    expect(p).toEqual({ bank: 3, map: 1, x: 0x1a, y: 0x1b, unknown: 0x1234 });
    expect([...flyPositionCodec.encode(p)]).toEqual([...bytes]);
  });

  it("マップのフライトポジションはバンク・マップが一致する最初の 1 件", () => {
    const list = [
      { bank: 3, map: 0, x: 1, y: 2, unknown: 0 },
      { bank: 3, map: 1, x: 3, y: 4, unknown: 0 },
      { bank: 3, map: 1, x: 5, y: 6, unknown: 0 },
    ];
    expect(findFlyPosition(list, { bank: 3, map: 1 })).toBe(1);
    expect(findFlyPosition(list, { bank: 4, map: 0 })).toBe(-1);
  });

  it("setFlyPosition で変えて、アンドゥ・リドゥで戻る", () => {
    const store = new DocumentStore();
    store.flyPositions.push({ bank: 3, map: 0, x: 6, y: 8, unknown: 0 });
    const bus = new CommandBus(store);
    const registry = createDefaultRegistry();
    bus.execute(registry.create({ name: "setFlyPosition", args: { index: 0, fields: { x: 0x10, bank: 4 } } }));
    expect(store.flyPositions[0]).toEqual({ bank: 4, map: 0, x: 0x10, y: 8, unknown: 0 });
    bus.undo();
    expect(store.flyPositions[0]).toEqual({ bank: 3, map: 0, x: 6, y: 8, unknown: 0 });
    bus.redo();
    expect(store.flyPositions[0]!.x).toBe(0x10);
  });

  it("範囲外の値・番号・知らない項目は EditError で、何も変えない", () => {
    const store = new DocumentStore();
    store.flyPositions.push({ bank: 3, map: 0, x: 6, y: 8, unknown: 0 });
    const run = (args: ConstructorParameters<typeof SetFlyPositionCommand>[0]) => new SetFlyPositionCommand(args).do(store);
    expect(() => run({ index: 0, fields: { x: 2, bank: 256 } })).toThrow(EditError);
    expect(() => run({ index: 1, fields: { x: 1 } })).toThrow(EditError);
    expect(() => run({ index: 0, fields: { z: 1 } })).toThrow(EditError);
    expect(store.flyPositions[0]!.x).toBe(6);
  });
});

const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("実 ROM のフライトポジション", () => {
  it("マサラタウン（3.0）は表の先頭（0x3B5944）、X=6 Y=8", async () => {
    const project = await CfruProject.open(new Uint8Array(readFileSync(romPath!)), new MemoryProjectFs());
    const table = project.flyTable!;
    expect(table.offset).toBe(0x3b5944);
    expect(table.entries).toHaveLength(20);
    const fly = project.editorContext().flyPositions;
    const i = findFlyPosition(fly, { bank: 3, map: 0 });
    expect(i).toBe(0);
    expect(fly[i]).toEqual({ bank: 3, map: 0, x: 6, y: 8, unknown: 0 });
    expect(fly[findFlyPosition(fly, { bank: 3, map: 1 })]).toMatchObject({ x: 0x1a, y: 0x1b });
    expect(findFlyPosition(fly, { bank: 4, map: 1 })).toBe(-1);
  });
});
