import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OverworldSprites, Rom, SPECIES_COUNT, SpeciesNameTable, requireSupportedGame } from "../src/index.js";

/** 実 ROM のパス。設定されていなければこのファイルのテストは飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("実 ROM: 種族名と OW 画像（ZIGZAGU_TEST_ROM）", () => {
  const load = () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    return { rom, offsets: requireSupportedGame(rom).offsets };
  };

  it("種族名表を読む（AdvanceMap の野生タブの一覧と同じ）", () => {
    const { rom, offsets } = load();
    const names = SpeciesNameTable.read(rom, offsets.speciesNameTablePointer);
    expect(names.name(0)).toBe("?????");
    expect(names.name(1)).toBe("フシギダネ");
    expect(names.name(16)).toBe("ポッポ");
    expect(names.name(26)).toBe("ライチュウ");
    for (let i = 0; i < SPECIES_COUNT; i++) expect(names.name(i)).not.toBeNull();
  });

  it("OW の 1 コマ目を作る（人 0 番は 16×32、透明の 0 番がある）", () => {
    const { rom, offsets } = load();
    const sprites = OverworldSprites.read(rom, offsets.overworldGraphicsTablePointer, offsets.overworldPaletteTablePointer);
    const image = sprites.image(0)!;
    expect(image.width).toBe(16);
    expect(image.height).toBe(32);
    let transparent = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] === 0) transparent++;
    expect(transparent).toBeGreaterThan(0);
    expect(transparent).toBeLessThan(16 * 32);
    // 素の FR の 152 種類はすべて描ける。
    for (let id = 0; id < 152; id++) expect(sprites.image(id), `画像 ${id}`).not.toBeNull();
  });
});
