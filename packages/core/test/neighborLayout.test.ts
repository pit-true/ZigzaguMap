import { describe, expect, it } from "vitest";
import { inverseOf, layoutNeighbors, oppositeDirection, resolveCell, type MapConnection, type MapId } from "../src/index.js";

const conn = (direction: number, offset: number, bank: number, map: number): MapConnection => ({ direction, offset, bank, map, padding: 0 });
const sizes = new Map<string, { width: number; height: number }>([
  ["3.19", { width: 24, height: 40 }],
  ["3.1", { width: 20, height: 20 }],
  ["3.2", { width: 30, height: 10 }],
  ["3.3", { width: 10, height: 30 }],
]);
const sizeOf = (id: MapId) => sizes.get(`${id.bank}.${id.map}`) ?? null;

describe("layoutNeighbors", () => {
  it("4 方向の置き場所と、境界から 8 マスの帯", () => {
    const main = { width: 24, height: 20, connections: [conn(2, 0, 3, 19), conn(1, -2, 3, 1), conn(3, 5, 3, 2), conn(4, -3, 3, 3)] };
    const r = layoutNeighbors(main, sizeOf, 8);
    const [up, down, left, right] = r.neighbors;
    expect(up!.placement).toEqual({ x: 0, y: -40, width: 24, height: 40 });
    expect(up!.band).toEqual({ x: 0, y: 32, width: 24, height: 8 });
    expect(up!.bandAt).toEqual({ x: 0, y: -8, width: 24, height: 8 });
    expect(down!.placement).toEqual({ x: -2, y: 20, width: 20, height: 20 });
    expect(down!.band).toEqual({ x: 0, y: 0, width: 20, height: 8 });
    expect(left!.placement).toEqual({ x: -30, y: 5, width: 30, height: 10 });
    expect(left!.band).toEqual({ x: 22, y: 0, width: 8, height: 10 });
    expect(right!.placement).toEqual({ x: 24, y: -3, width: 10, height: 30 });
    // 上へ 3 はみ出す分は、上の余白（8）の中なので見せる
    expect(right!.bandAt).toEqual({ x: 24, y: -3, width: 8, height: 30 });
    expect(r.margins).toEqual({ left: 8, top: 8, right: 8, bottom: 8 });
    expect(r.connectedSides.sort()).toEqual(["down", "left", "right", "up"]);
  });

  it("負の offset で横にはみ出す分は帯の幅で切る", () => {
    const main = { width: 10, height: 10, connections: [conn(1, -20, 3, 2)] };
    const r = layoutNeighbors(main, sizeOf, 8);
    expect(r.neighbors[0]!.bandAt).toEqual({ x: -8, y: 10, width: 10 + 8, height: 8 });
    expect(r.neighbors[0]!.band).toEqual({ x: 12, y: 0, width: 18, height: 8 });
    expect(r.margins).toEqual({ left: 8, top: 0, right: 0, bottom: 8 });
  });

  it("範囲が null ならマップ全体", () => {
    const main = { width: 24, height: 20, connections: [conn(2, 0, 3, 19)] };
    const r = layoutNeighbors(main, sizeOf, null);
    expect(r.neighbors[0]!.band).toEqual({ x: 0, y: 0, width: 24, height: 40 });
    expect(r.margins.top).toBe(40);
  });

  it("ダイブ・浮上と読めない相手は並べず、遠すぎる相手は帯に入らない", () => {
    const main = { width: 24, height: 20, connections: [conn(5, 0, 3, 19), conn(6, 0, 3, 19), conn(1, 0, 9, 9), conn(1, 100, 3, 1)] };
    const r = layoutNeighbors(main, sizeOf, 8);
    expect(r.neighbors).toEqual([]);
    expect(r.margins).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe("inverseOf", () => {
  it("逆向きで自分を指す接続を探す。複数なら -offset のもの", () => {
    const list = [conn(1, 0, 3, 5), conn(2, 4, 3, 0), conn(2, -3, 3, 0)];
    expect(inverseOf(list, { bank: 3, map: 0 }, 1, 3)).toBe(2);
    expect(inverseOf(list, { bank: 3, map: 0 }, 1)).toBe(1);
    expect(inverseOf(list, { bank: 3, map: 0 }, 3)).toBeNull();
    expect(inverseOf(null, { bank: 3, map: 0 }, 1)).toBeNull();
    expect(oppositeDirection(5)).toBe(6);
  });
});

describe("resolveCell", () => {
  it("画面のマスをどのマップのマスかに変える", () => {
    const main = { id: { bank: 3, map: 0 }, width: 24, height: 20, connections: [conn(2, 0, 3, 19), conn(1, -2, 3, 1)] };
    const r = layoutNeighbors(main, sizeOf, 8);
    expect(resolveCell(r, main, 3, 4)).toMatchObject({ id: { bank: 3, map: 0 }, x: 3, y: 4, neighbor: null });
    expect(resolveCell(r, main, 3, -1)).toMatchObject({ id: { bank: 3, map: 19 }, x: 3, y: 39 });
    expect(resolveCell(r, main, 0, 20)).toMatchObject({ id: { bank: 3, map: 1 }, x: 2, y: 0 });
    // 帯の外（8 マスより向こう）と、何も無いところ
    expect(resolveCell(r, main, 3, -9)).toBeNull();
    expect(resolveCell(r, main, -1, 5)).toBeNull();
  });
});
