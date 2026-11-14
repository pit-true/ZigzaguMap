import { describe, expect, it } from "vitest";
import { BlockGrid, CommandBus, EditError, ResizeMapEdgeCommand, affectedMaps, type MapConnection } from "../src/index.js";
import { M00, M01, openLoaded, roundTrip } from "./helpers/editHarness.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();
const conn = (direction: number, offset: number, bank: number, map: number): MapConnection => ({ direction, offset, bank, map, padding: 0 });

/** 0.0 の下に 0.1（ずれ 2）と、0.1 の上に 0.0（ずれ -2）。0.0 には右の接続（相手 0.1、ずれ 1）も。 */
async function open() {
  const p = await openLoaded(rom);
  // 6×6 の配置（マスの値は位置ごとに違う）
  p.loaded(M00)!.grid = new BlockGrid(6, 6, Uint16Array.from({ length: 36 }, (_, i) => i + 1));
  p.loaded(M00)!.connections = [conn(1, 2, 0, 1), conn(4, 1, 0, 1)];
  p.loaded(M01)!.connections = [conn(2, -2, 0, 0), conn(3, -1, 0, 0)];
  return p;
}

describe("ResizeMapEdgeCommand", () => {
  it("右へ広げると、増えた列は右端の列の写し。イベントと接続は変えない", async () => {
    await roundTrip(open, () => ResizeMapEdgeCommand.of(M00, "right", 2, [M01]), (p) => {
      const doc = p.loaded(M00)!;
      const before = doc.grid;
      expect(doc.width).toBeGreaterThan(2);
      for (let y = 0; y < doc.height; y++) expect(before.getCell(doc.width - 1, y)).toBe(before.getCell(doc.width - 3, y));
      expect(doc.connections).toEqual([conn(1, 2, 0, 1), conn(4, 1, 0, 1)]);
    });
  });

  it("左へ広げると配置・イベント・上下の接続（相手の逆も）をずらす。1 回の取り消しで全部戻る", async () => {
    const base = await open();
    const w = base.loaded(M00)!.width;
    const firstCol = [...Array(base.loaded(M00)!.height).keys()].map((y) => base.loaded(M00)!.grid.getCell(0, y));
    const person = { ...base.loaded(M00)!.events!.persons[0]! };
    await roundTrip(open, () => ResizeMapEdgeCommand.of(M00, "left", 3, [M01]), (p) => {
      const doc = p.loaded(M00)!;
      expect(doc.width).toBe(w + 3);
      for (let y = 0; y < doc.height; y++) {
        expect(doc.grid.getCell(0, y)).toBe(firstCol[y]);
        expect(doc.grid.getCell(3, y)).toBe(firstCol[y]);
      }
      expect(doc.events!.persons[0]!.x).toBe(person.x + 3);
      expect(doc.events!.persons[0]!.y).toBe(person.y);
      expect(doc.connections).toEqual([conn(1, 5, 0, 1), conn(4, 1, 0, 1)]);
      expect(p.loaded(M01)!.connections).toEqual([conn(2, -5, 0, 0), conn(3, -1, 0, 0)]);
    });
  });

  it("上へ縮めると左右の接続のずれを引く", async () => {
    await roundTrip(open, () => ResizeMapEdgeCommand.of(M00, "up", -1, [M01]), (p) => {
      expect(p.loaded(M00)!.connections).toEqual([conn(1, 2, 0, 1), conn(4, 0, 0, 1)]);
      expect(p.loaded(M01)!.connections).toEqual([conn(2, -2, 0, 0), conn(3, 0, 0, 0)]);
    });
  });

  it("フライトポジションがこのマップを指していればずらす", async () => {
    const p = await open();
    const ctx = p.editorContext();
    if (ctx.flyPositions.length === 0) return;
    Object.assign(ctx.flyPositions[0]!, { bank: 0, map: 0, x: 4, y: 5 });
    const bus = new CommandBus(ctx);
    bus.execute(ResizeMapEdgeCommand.of(M00, "up", 2, [M01]));
    expect(ctx.flyPositions[0]).toMatchObject({ x: 4, y: 7 });
    bus.undo();
    expect(ctx.flyPositions[0]).toMatchObject({ x: 4, y: 5 });
  });

  it("大きさの制限と、4 未満にはできない。targets に相手が入る", async () => {
    const p = await open();
    const bus = new CommandBus(p.editorContext());
    const w = p.loaded(M00)!.width;
    expect(() => bus.execute(ResizeMapEdgeCommand.of(M00, "right", 4 - w - 1, []))).toThrow(EditError);
    expect(() => bus.execute(ResizeMapEdgeCommand.of(M00, "down", 1000, []))).toThrow(EditError);
    expect(p.loaded(M00)!.width).toBe(w);
    expect(affectedMaps(ResizeMapEdgeCommand.of(M00, "left", 1, [M01]))).toEqual([M00, M01]);
  });
});
