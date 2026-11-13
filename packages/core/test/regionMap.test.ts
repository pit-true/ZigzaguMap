import { describe, expect, it } from "vitest";
import {
  CommandBus,
  DocumentStore,
  EditError,
  FLY_DESTINATION_COUNT,
  HEAL_LOCATION_COUNT,
  MAPSEC_COUNT,
  REGION_MAP_CELLS,
  RegionMapDocument,
  RegionMapJson,
  SetRegionCellsCommand,
  SetRegionFlagCommand,
  SetRegionSectionCommand,
  createDefaultRegistry,
  withRegionMap,
  type RegionMapSnapshot,
} from "../src/index.js";

/** 作り物のタウンマップ。 */
function sample(): RegionMapDocument {
  const s: RegionMapSnapshot = {
    layouts: Array.from({ length: 8 }, () => new Array<number>(REGION_MAP_CELLS).fill(0xc5)),
    sections: Array.from({ length: MAPSEC_COUNT }, (_, i) => ({ x: i % 22, y: i % 15, width: 1, height: 1 })),
    fly: Array.from({ length: FLY_DESTINATION_COUNT }, (_, i) => ({ bank: 3, map: i, heal: 0 })),
    heal: Array.from({ length: HEAL_LOCATION_COUNT }, (_, i) => ({ bank: 3, map: i, x: 6, y: 8 })),
    mapFlags: new Array<number>(MAPSEC_COUNT).fill(0xffff),
    dungeonFlags: new Array<number>(MAPSEC_COUNT).fill(0xffff),
  };
  s.layouts[0]![11 * 22 + 4] = 0x58;
  return new RegionMapDocument(s);
}

describe("タウンマップの表", () => {
  it("ベースと同じなら regionmap.json は書かない", () => {
    const base = sample();
    expect(RegionMapJson.stringify(base.clone(), base)).toBeNull();
  });

  it("変えた表だけを書き、読み直すと同じになる", () => {
    const base = sample();
    const doc = base.clone();
    doc.setCell(2, 1, 3, 4, 0x7e);
    doc.setSection(0x60, { x: 9, y: 9, width: 2, height: 3 });
    doc.setFlag(1, 0x7e, 0x8b0);
    const text = RegionMapJson.stringify(doc, base)!;
    expect(text).toContain('"Page": "sevii45"');
    expect(text).toContain('"Layer": "dungeon"');
    expect(text).toContain('"Positions"');
    expect(text).toContain('"Sizes"');
    expect(text).toContain('"Flag": "0x08B0"');
    expect(text).not.toContain("FlyDestinations");
    expect(text).not.toContain("MapVisitFlags");
    expect(text.endsWith("\r\n")).toBe(true);
    const back = RegionMapJson.parse(text, base);
    expect(back.equals(doc)).toBe(true);
  });

  it("形の違う regionmap.json はエラー", () => {
    const base = sample();
    expect(() => RegionMapJson.parse('{"Format":2}', base)).toThrow();
    expect(() => RegionMapJson.parse('{"Format":1,"Positions":[]}', base)).toThrow();
    expect(() => RegionMapJson.parse('{"Format":1,"Unknown":1}', base)).toThrow();
  });

  it("コマンドの実行・取り消し・やり直し", () => {
    const doc = sample();
    const before = doc.snapshot();
    const bus = new CommandBus(withRegionMap(new DocumentStore(), () => doc));
    bus.execute(new SetRegionSectionCommand({ id: 0x58, x: 1, y: 2, flyBank: 4, flyMap: 5, flyHeal: 2, healIndex: 2, healX: 3, healY: 4 }));
    bus.execute(new SetRegionCellsCommand({ page: 0, layer: 0, cells: [{ x: 0, y: 0, value: 0x58 }] }));
    bus.execute(new SetRegionFlagCommand({ layer: 0, id: 0x58, flag: 0x890 }));
    const after = doc.snapshot();
    expect(doc.section(0x58)).toMatchObject({ x: 1, y: 2 });
    expect(doc.flyDestination(0x58)).toEqual({ bank: 4, map: 5, heal: 2 });
    expect(doc.healLocation(2)).toEqual({ bank: 3, map: 1, x: 3, y: 4 });
    expect(doc.cell(0, 0, 0, 0)).toBe(0x58);
    expect(doc.flag(0, 0x58)).toBe(0x890);
    while (bus.undo());
    expect(doc.snapshot()).toEqual(before);
    while (bus.redo());
    expect(doc.snapshot()).toEqual(after);
  });

  it("範囲外の値は EditError で、何も変わらない", () => {
    const doc = sample();
    const before = doc.snapshot();
    const ctx = withRegionMap(new DocumentStore(), () => doc);
    expect(() => new SetRegionSectionCommand({ id: 0x57 }).do(ctx)).toThrow(EditError);
    expect(() => new SetRegionSectionCommand({ id: 0xc4, flyBank: 1 }).do(ctx)).toThrow(EditError);
    expect(() => new SetRegionSectionCommand({ id: 0x58, x: 1, healX: 3 }).do(ctx)).toThrow(EditError);
    expect(() => new SetRegionCellsCommand({ page: 4, layer: 0, cells: [{ x: 0, y: 0, value: 1 }] }).do(ctx)).toThrow(EditError);
    expect(() => new SetRegionFlagCommand({ layer: 0, id: 0x58, flag: 0x10000 }).do(ctx)).toThrow(EditError);
    expect(doc.snapshot()).toEqual(before);
  });

  it("JSON の引数から再生できる", () => {
    const doc = sample();
    const registry = createDefaultRegistry();
    for (const name of ["setRegionSection", "setRegionCells", "setRegionFlag"]) expect(registry.names()).toContain(name);
    const bus = new CommandBus(withRegionMap(new DocumentStore(), () => doc));
    const records = [
      { name: "setRegionSection", args: { id: 0x59, width: 3, height: 2 } },
      { name: "setRegionCells", args: { page: 1, layer: 1, cells: [{ x: 21, y: 14, value: 0x80 }] } },
    ];
    for (const r of records) bus.execute(registry.create(r));
    expect(bus.history()).toEqual(records);
    expect(doc.section(0x59)).toMatchObject({ width: 3, height: 2 });
    expect(doc.cell(1, 1, 21, 14)).toBe(0x80);
  });
});
