import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MapBankTable, Rom, findPointerRefs, findPointerRefsChunked, knownMapRanges, listMapPointers, rangeAt, requireSupportedGame, toPointerValue } from "../src/index.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

describe("ポインタの参照元の検索（#307）", () => {
  it("4 バイト境界のポインタだけを探す", () => {
    const b = new Uint8Array(32);
    const put = (at: number, v: number) => new DataView(b.buffer).setUint32(at, v, true);
    put(4, 0x08123456);
    put(13, 0x08123456); // 境界でない
    put(20, 0x08123456);
    put(24, 0x09123456);
    expect(findPointerRefs(b, 0x08123456)).toEqual([4, 20]);
    expect(findPointerRefs(b, 0x08123456, 8)).toEqual([20]);
  });

  it("小分けに探しても同じ結果", async () => {
    const b = new Uint8Array(4096);
    const dv = new DataView(b.buffer);
    for (const at of [0, 1020, 1024, 2048, 4092]) dv.setUint32(at, 0x08000100, true);
    const pauses: number[] = [];
    const found = await findPointerRefsChunked(b, 0x08000100, { chunk: 1024, pause: async () => void pauses.push(1) });
    expect(found).toEqual([0, 1020, 1024, 2048, 4092]);
    expect(pauses.length).toBe(3);
  });

  it("位置とポインタの値のどちらでも受け付ける", () => {
    expect(toPointerValue(0x1234)).toBe(0x08001234);
    expect(toPointerValue(0x08001234)).toBe(0x08001234);
    expect(toPointerValue(0x2000000)).toBeNull();
    expect(toPointerValue(-1)).toBeNull();
  });
});

describe("マップのポインタの一覧（#307）", () => {
  const rom = new Rom(buildSyntheticRom());
  const banks = MapBankTable.read(rom, 0x54b0c);

  it("マップの表・ヘッダー・フッターの順に、置き場所と値とバイト列", () => {
    const list = listMapPointers(rom, banks, { bank: 0, map: 1 });
    expect(list[0]).toEqual({ kind: "header", index: null, location: SYN.bank0List + 4, value: 0x08000000 + SYN.headers + 28, bytes: [0x1c, 0x60, 0x05, 0x08] });
    expect(list.map((p) => p.kind).slice(0, 5)).toEqual(["header", "layout", "events", "scripts", "connections"]);
    const layout = list.find((p) => p.kind === "layout")!;
    expect(layout.location).toBe(SYN.headers + 28);
    expect(layout.value).toBe(0x08000000 + SYN.footer);
    expect(list.find((p) => p.kind === "primaryTileset")!.value).toBe(0x08000000 + SYN.primaryHeader);
  });

  it("無いマップは空", () => {
    expect(listMapPointers(rom, banks, { bank: 0, map: 9 })).toEqual([]);
    expect(listMapPointers(rom, banks, { bank: 7, map: 0 })).toEqual([]);
  });

  it("見つかった場所の名前（バンクの一覧の何番目か）", () => {
    const ranges = knownMapRanges(rom, banks);
    const found = findPointerRefs(rom.bytes, 0x08000000 + SYN.headers + 28);
    expect(found).toEqual([SYN.bank0List + 4]);
    const hit = rangeAt(ranges, found[0]!)!;
    expect(hit.range.kind).toBe("bankList");
    expect(hit.range.index).toBe(0);
    expect(hit.element).toBe(1);
    // フッターは 3 枚のヘッダーが共有している
    const footerRefs = findPointerRefs(rom.bytes, 0x08000000 + SYN.footer).map((at) => rangeAt(ranges, at)!.range);
    expect(footerRefs.map((r) => [r.kind, r.map])).toEqual([
      ["header", { bank: 0, map: 0 }],
      ["header", { bank: 0, map: 1 }],
      ["header", { bank: 1, map: 0 }],
    ]);
  });
});

const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("ポインタの参照元の検索（素の BPRJ）", () => {
  it("マップ 3.0 のヘッダーの場所を探すと、マップの表の中の 1 か所が出る", () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const banks = MapBankTable.read(rom, requireSupportedGame(rom).offsets.mapBankTablePointer);
    const header = banks.headerOffset({ bank: 3, map: 0 });
    const found = findPointerRefs(rom.bytes, 0x08000000 + header);
    expect(found).toHaveLength(1);
    const hit = rangeAt(knownMapRanges(rom, banks), found[0]!)!;
    expect(hit.range.kind).toBe("bankList");
    expect(hit.range.index).toBe(3);
    expect(hit.element).toBe(0);
    const list = listMapPointers(rom, banks, { bank: 3, map: 0 });
    expect(list.filter((p) => p.kind === "personScript").length).toBeGreaterThan(0);
  });
});
