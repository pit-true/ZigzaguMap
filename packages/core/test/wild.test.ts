import { describe, expect, it } from "vitest";
import { BPRJ_OFFSETS, Rom, WildTable, wildHeaderCodec, wildInfoCodec, wildSlotCodec } from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

function pattern(length: number, seed = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 53 + seed * 11) & 0xff);
}

describe("野生", () => {
  const rom = new Rom(buildSyntheticRom());

  it("構造体が decode → encode で元に戻る", () => {
    for (let seed = 0; seed < 8; seed++) {
      for (const codec of [wildHeaderCodec, wildInfoCodec, wildSlotCodec]) {
        const b = pattern(codec.size * 2, seed);
        expect((codec.encodeList as (v: unknown[]) => Uint8Array)(codec.decodeAll(b) as unknown[])).toEqual(b);
      }
    }
  });

  it("表を読み、マップの野生を引く", () => {
    const table = WildTable.read(rom, BPRJ_OFFSETS.wildHeaderTablePointer);
    expect(table.entries).toHaveLength(1);
    const [day] = table.readEncounters(0, 0);
    expect(day!.time).toBe(1);
    expect(day!.areas.map((a) => a.slots.length)).toEqual([0, 5, 0, 0]);
    expect(day!.areas[1]!.rate).toBe(4);
    expect(day!.areas[1]!.slots[0]).toEqual({ minLevel: 5, maxLevel: 10, species: 0x81 });
    expect(table.readEncounters(1, 0)).toEqual([]);
  });
});
