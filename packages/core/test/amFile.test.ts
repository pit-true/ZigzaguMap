import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DataError, decodeAmEvents, decodeAmMap, encodeAmEvents, encodeAmMap } from "../src/index.js";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/am/${name}`, import.meta.url)));

describe(".map / .evt の読み書き", () => {
  it("AdvanceMap 1.92 の形式（先頭 20 バイト + 境界 + 配置）を読み、同じバイト列に書き戻す", () => {
    const bytes = fixture("current.map");
    const data = decodeAmMap(bytes);
    expect([data.width, data.height, data.primaryTileset, data.secondaryTileset, data.borderWidth, data.borderHeight]).toEqual([5, 4, 0, 1, 2, 2]);
    expect([...data.border]).toEqual([0x1c, 0x1d, 0x14, 0x15]);
    expect(data.cells[0]).toBe(0x3001);
    expect(data.cells[3]).toBe(0x3004);
    expect(encodeAmMap(data)).toEqual(bytes);
  });

  it("境界が 2×2 でないもの（境界の幅・高さ × 2 バイト）", () => {
    const bytes = fixture("border3x1.map");
    const data = decodeAmMap(bytes);
    expect([data.borderWidth, data.borderHeight, ...data.border]).toEqual([3, 1, 0x1c, 0x1d, 0x14]);
    expect(encodeAmMap(data)).toEqual(bytes);
  });

  it("古い形式（境界 2×2 + 配置 + 末尾に大きさとタイルセット）も読む。書くときは新しい形式", () => {
    const data = decodeAmMap(fixture("old.map"));
    expect([data.width, data.height, data.primaryTileset, data.secondaryTileset, data.borderWidth, data.borderHeight]).toEqual([3, 2, 0, 1, 2, 2]);
    expect([...data.border]).toEqual([0x10, 0x11, 0x12, 0x13]);
    expect([...data.cells]).toEqual([0x3001, 0x3002, 0x3003, 0x3004, 0x3005, 0x3006]);
    expect(decodeAmMap(encodeAmMap(data))).toEqual(data);
    expect(encodeAmMap(data).slice(0x10, 0x14)).toEqual(Uint8Array.from([2, 2, 0xc0, 0x00]));
  });

  it("長さの合わないファイルは DataError", () => {
    expect(() => decodeAmMap(fixture("current.map").slice(0, 60))).toThrow(DataError);
    expect(() => decodeAmMap(new Uint8Array(3))).toThrow(DataError);
    expect(() => decodeAmEvents(fixture("current.evt").slice(1))).toThrow(DataError);
  });

  it(".evt: 一覧を人・ワープ・スクリプト・看板の順に並べ、末尾に件数 4 バイト", () => {
    const bytes = fixture("current.evt");
    const events = decodeAmEvents(bytes);
    expect([events.persons.length, events.warps.length, events.traps.length, events.signs.length]).toEqual([1, 1, 0, 1]);
    expect(events.persons[0]).toMatchObject({ localId: 1, graphicsId: 7, x: 2, y: 1, elevation: 3, movementType: 1, script: 0x0816f884 });
    expect(events.warps[0]).toMatchObject({ x: 3, y: 2, warpId: 0, map: 0, bank: 4 });
    expect(events.signs[0]).toMatchObject({ x: 1, y: 1, content: { type: "script", script: 0x0816f960 } });
    expect(encodeAmEvents(events)).toEqual(bytes);
    expect(encodeAmEvents(null)).toEqual(new Uint8Array(4));
  });
});
