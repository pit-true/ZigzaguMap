import { describe, expect, it } from "vitest";
import { DataError, MapScriptReader, Rom, mapScriptCodec } from "../src/index.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

describe("マップスクリプト", () => {
  const rom = new Rom(buildSyntheticRom());

  it("一覧と条件表を読み、元のバイト列に戻る", () => {
    const raw = new MapScriptReader(rom).readRaw(SYN.scripts);
    expect(raw.list.length).toBe(11);
    const heads = mapScriptCodec.decodeList(raw.list);
    expect(heads).toEqual([
      { type: 1, pointer: 0x08123456 },
      { type: 2, pointer: 0x08000000 + SYN.scriptTable },
    ]);
    expect(mapScriptCodec.encodeList(heads)).toEqual(raw.list);
    const table = raw.tables.get(1)!;
    expect(table.length).toBe(16);
    const decoded = mapScriptCodec.decodeTable(table);
    expect(decoded.entries).toEqual([{ variable: 0x4001, value: 3, script: 0x08654321 }]);
    expect([...decoded.tail]).toEqual([0, 0, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    expect(mapScriptCodec.encodeTable(decoded)).toEqual(table);
  });

  it("read は条件表つきの件を返す", () => {
    const entries = new MapScriptReader(rom).read(SYN.scripts);
    expect(entries[0]!.table).toBeNull();
    expect(entries[1]!.table!.entries).toHaveLength(1);
  });

  it("終端の無い一覧は DataError", () => {
    expect(() => mapScriptCodec.decodeList(Uint8Array.from([1, 0, 0, 0, 8]))).toThrow(DataError);
    expect(() => mapScriptCodec.decodeList(Uint8Array.from([0, 0]))).toThrow(DataError);
  });
});
