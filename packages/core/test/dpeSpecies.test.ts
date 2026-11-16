import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DpeSpecies } from "../src/name/DpeSpecies.js";

describe("DPE の種族名", () => {
  it("数値・別名・式を解決し、名前のラベルで対応させる", () => {
    const table = DpeSpecies.parse("#define SPECIES_A 2\n#define SPECIES_B NEXT\n#define NEXT 1\n#define NUM_SPECIES (SPECIES_A + 1)", "#org @NAME_A\nエー\n#org @NAME_B\nビー\n");
    expect(table.count).toBe(3);
    expect(table.name(2)).toBe("エー");
    expect(table.name(1)).toBe("ビー");
    expect(table.name(0)).toBeNull();
    expect(table.name(-1)).toBeNull();
  });
  it("定義と対応しないラベルは並び順で補い、欠けた名前は null", () => {
    const table = DpeSpecies.parse("#define NUM_SPECIES 4\n#define SPECIES_NONE 0\n#define SPECIES_A 2", "#org @gSpeciesNames\n\n#org @NAME_NONE\n？？？\n#org @NAME_UNUSED\n未使用\n#org @NAME_A\nエー\n");
    expect([0, 1, 2, 3].map((i) => table.name(i))).toEqual(["？？？", "未使用", "エー", null]);
  });
  it("循環した定義や空の名前表は拒む", () => {
    expect(() => DpeSpecies.parse("#define NUM_SPECIES B\n#define B NUM_SPECIES", "#org @NAME_A\nエー")).toThrow();
    expect(() => DpeSpecies.parse("#define NUM_SPECIES 2", "")).toThrow();
  });
});


const roots: string[] = JSON.parse(process.env.ZIGZAGU_DPE_ROOTS ?? "[]");
it.skipIf(roots.length === 0)("実フォルダの種族名と最後の番号", () => {
  for (const [index, root] of roots.entries()) {
    const table = DpeSpecies.parse(readFileSync(`${root}/include/species.h`, "utf8"), readFileSync(`${root}/strings/Pokemon_Name_Table.string`, "utf8"));
    expect(table.count).toBe(index === 0 ? 970 : 1573);
    expect(table.name(1)).toBe("フシギダネ");
    expect(table.name(table.count - 1)).toBeTruthy();
    console.log(`${root}: ${table.count}件、最後 ${table.count - 1} ${table.name(table.count - 1)}`);
  }
});
