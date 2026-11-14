import { describe, expect, it } from "vitest";
import {
  CommandBus,
  ConnectMapsCommand,
  DisconnectMapsCommand,
  EditError,
  NEW_CONNECTED_MAP_CELL,
  ShiftConnectionCommand,
  affectedMaps,
  centeredOffset,
  chooseSlot,
  createConnectedMap,
  freeSlots,
  newConnectedMapSize,
  type MapConnection,
} from "../src/index.js";
import { M00, M01, openLoaded, roundTrip } from "./helpers/editHarness.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();
const conn = (direction: number, offset: number, bank: number, map: number): MapConnection => ({ direction, offset, bank, map, padding: 0 });

/** 0.0 の下に 0.1（ずれ 2）、0.1 の上に 0.0（ずれ -2）をつないだプロジェクト。 */
async function openPaired(inverse = true) {
  const p = await openLoaded(rom);
  p.loaded(M00)!.connections = [conn(1, 2, 0, 1)];
  p.loaded(M01)!.connections = inverse ? [conn(3, 0, 5, 5), conn(2, -2, 0, 0)] : [];
  return p;
}

describe("ShiftConnectionCommand", () => {
  it("自分のずれを変え、相手の逆向きの接続を -offset にそろえる。1 回の取り消しで両方戻る", async () => {
    const p = await roundTrip(
      () => openPaired(),
      () => ShiftConnectionCommand.of(M00, 0, 5, M01),
      (q) => {
        expect(q.loaded(M00)!.connections![0]!.offset).toBe(5);
        expect(q.loaded(M01)!.connections![1]!.offset).toBe(-5);
        // 関係のない接続は変えない
        expect(q.loaded(M01)!.connections![0]!.offset).toBe(0);
      },
    );
    expect(p).toBeTruthy();
  });

  it("引数の targets に両方のマップが入る（未出力の印を両方に付けるため）", () => {
    const c = ShiftConnectionCommand.of(M00, 0, 5, M01);
    expect(affectedMaps(c)).toEqual([M00, M01]);
    expect(affectedMaps(ShiftConnectionCommand.of(M00, 0, 5, null))).toEqual([M00]);
  });

  it("相手に逆の接続が無ければ自分だけ変える", async () => {
    await roundTrip(
      () => openPaired(false),
      () => ShiftConnectionCommand.of(M00, 0, -3, M01),
      (q) => {
        expect(q.loaded(M00)!.connections![0]!.offset).toBe(-3);
        expect(q.loaded(M01)!.connections).toEqual([]);
      },
    );
  });

  it("相手をそろえない（targets が自分だけ）なら相手は変えない", async () => {
    const p = await openPaired();
    const bus = new CommandBus(p.editorContext());
    bus.execute(ShiftConnectionCommand.of(M00, 0, 7, null));
    expect(p.loaded(M00)!.connections![0]!.offset).toBe(7);
    expect(p.loaded(M01)!.connections![1]!.offset).toBe(-2);
  });

  it("番号の無い接続はエラーで、何も変わらない", async () => {
    const p = await openPaired();
    const bus = new CommandBus(p.editorContext());
    expect(() => bus.execute(ShiftConnectionCommand.of(M00, 3, 1, M01))).toThrow();
    expect(p.loaded(M01)!.connections![1]!.offset).toBe(-2);
  });
});

describe("ConnectionSlots", () => {
  const sizes: Record<string, { width: number; height: number }> = { "1.0": { width: 10, height: 10 }, "1.1": { width: 6, height: 6 } };
  const sizeOf = (id: { bank: number; map: number }) => sizes[`${id.bank}.${id.map}`] ?? null;

  it("覆われていない区間と、4 マス以上でいちばん長い区間", () => {
    const main = { width: 30, height: 20, connections: [conn(2, 5, 1, 0), conn(2, 18, 1, 1), conn(1, 0, 1, 0)] };
    expect(freeSlots(main, "up", sizeOf)).toEqual([
      { start: 0, length: 5 },
      { start: 15, length: 3 },
      { start: 24, length: 6 },
    ]);
    expect(chooseSlot(main, "up", sizeOf)).toEqual({ start: 24, length: 6 });
    expect(chooseSlot(main, "left", sizeOf)).toEqual({ start: 0, length: 20 });
  });

  it("空きが 4 マス未満なら辺の終わりに 4 マス", () => {
    const main = { width: 12, height: 20, connections: [conn(2, 0, 1, 0)] };
    expect(chooseSlot(main, "up", sizeOf)).toEqual({ start: 8, length: 4 });
  });

  it("新しいマップの大きさ（上限を超えたら縮める）と中央のずれ", () => {
    expect(newConnectedMapSize("up", { start: 0, length: 24 })).toEqual({ width: 24, height: 20 });
    expect(newConnectedMapSize("right", { start: 0, length: 30 })).toEqual({ width: 20, height: 30 });
    const big = newConnectedMapSize("up", { start: 0, length: 200 });
    expect((big.width + 15) * (big.height + 14)).toBeLessThanOrEqual(10240);
    expect(centeredOffset(24, 40)).toBe(-8);
    expect(centeredOffset(40, 24)).toBe(8);
  });
});

describe("ConnectMapsCommand / DisconnectMapsCommand", () => {
  it("つなぐと両方に接続ができ、1 回の取り消しで両方消える", async () => {
    await roundTrip(
      () => openPaired(false),
      () => ConnectMapsCommand.of(M01, 4, 3, M00),
      (q) => {
        expect(q.loaded(M01)!.connections).toEqual([conn(4, 3, 0, 0)]);
        expect(q.loaded(M00)!.connections).toEqual([conn(1, 2, 0, 1), conn(3, -3, 0, 1)]);
      },
    );
  });

  it("相手がもう逆向きの接続を持っていれば足さずにずれをそろえる", async () => {
    const p = await openLoaded(rom);
    p.loaded(M00)!.connections = [conn(1, 0, 0, 1)];
    p.loaded(M01)!.connections = [];
    new CommandBus(p.editorContext()).execute(ConnectMapsCommand.of(M01, 2, 4, M00));
    expect(p.loaded(M00)!.connections).toEqual([conn(1, -4, 0, 1)]);
  });

  it("ダイブ・浮上は 1 枚に 1 つまで", async () => {
    const p = await openLoaded(rom);
    p.loaded(M00)!.connections = [];
    p.loaded(M01)!.connections = [conn(6, 0, 3, 3)];
    const bus = new CommandBus(p.editorContext());
    // 0.0 から 0.1 へダイブ → 0.1 はもう浮上を持っている
    expect(() => bus.execute(ConnectMapsCommand.of(M00, 5, 0, M01))).toThrow(EditError);
    expect(p.loaded(M00)!.connections).toEqual([]);
    p.loaded(M01)!.connections = [];
    bus.execute(ConnectMapsCommand.of(M00, 5, 7, M01));
    expect(p.loaded(M00)!.connections).toEqual([conn(5, 0, 0, 1)]);
    expect(p.loaded(M01)!.connections).toEqual([conn(6, 0, 0, 0)]);
  });

  it("消すと相手の逆の接続も消え、1 回の取り消しで両方戻る", async () => {
    await roundTrip(
      () => openPaired(),
      () => DisconnectMapsCommand.of(M00, 0, M01),
      (q) => {
        expect(q.loaded(M00)!.connections).toEqual([]);
        expect(q.loaded(M01)!.connections).toEqual([conn(3, 0, 5, 5)]);
      },
    );
  });
});

describe("createConnectedMap", () => {
  it("新しいマップを作って両側をつなぐ。1 回の取り消しでマップも消える", async () => {
    const p = await openLoaded(rom);
    p.loaded(M00)!.connections = [];
    const bus = new CommandBus(p.editorContext());
    const before = p.bankCounts();
    const target = { bank: 0, map: before[0]! };
    const cmd = createConnectedMap(p.editorContext(), { from: M00, target, direction: 4, offset: 1, width: 7, height: 5 });
    bus.execute(cmd);
    const doc = p.loaded(target)!;
    expect(doc.width).toBe(7);
    expect(doc.height).toBe(5);
    expect([...new Set(doc.grid.cells)]).toEqual([NEW_CONNECTED_MAP_CELL]);
    expect([...doc.border.cells]).toEqual([...p.loaded(M00)!.border.cells]);
    expect(doc.primaryTileset).toBe(p.loaded(M00)!.primaryTileset);
    expect(doc.header.music).toBe(p.loaded(M00)!.header.music);
    expect(p.loaded(M00)!.connections).toEqual([conn(4, 1, 0, target.map)]);
    expect(doc.connections).toEqual([conn(3, -1, 0, 0)]);
    expect(affectedMaps(cmd)).toEqual(expect.arrayContaining([M00, target]));
    bus.undo();
    expect(p.loaded(target)).toBeUndefined();
    expect(p.bankCounts()).toEqual(before);
    expect(p.loaded(M00)!.connections).toEqual([]);
  });
});
