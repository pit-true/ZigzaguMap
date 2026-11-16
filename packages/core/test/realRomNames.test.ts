import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OverworldEffects, OverworldSprites, Rom, SPECIES_COUNT, SpeciesNameTable, matchReading, normalizeReading, readingTokens, requireSupportedGame, romajiReading, toHiragana } from "../src/index.js";

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

  it("主人公の四方向・歩き・走りを ROM の表から読み、左右反転を適用する", () => {
    const { rom, offsets } = load();
    const sprites = OverworldSprites.read(rom, offsets.overworldGraphicsTablePointer, offsets.overworldPaletteTablePointer);
    const images = [0, 1, 2, 3].map(direction => sprites.frameImage(0, sprites.animationFrame(0, direction, 0)!)!);
    expect(images[0]!.data).not.toEqual(images[1]!.data);
    expect(images[0]!.data).not.toEqual(images[2]!.data);
    const left = images[2]!, right = images[3]!;
    for (let y = 0; y < left.height; y++) for (let x = 0; x < left.width; x++) {
      const a = (y * left.width + x) * 4;
      const b = (y * right.width + right.width - 1 - x) * 4;
      expect(left.data.slice(a, a + 4)).toEqual(right.data.slice(b, b + 4));
    }
    for (const animation of [4, 5, 6, 7, 20, 21, 22, 23]) {
      const frames = new Set<number>();
      for (let t = 0; t < 64; t++) {
        const frame = sprites.animationFrame(0, animation, t);
        expect(frame, `animation ${animation} at ${t}`).not.toBeNull();
        expect(sprites.frameImage(0, frame!)).not.toBeNull();
        frames.add(frame!.index);
      }
      expect(frames.size).toBeGreaterThan(1);
    }
  });

  it("人物に指定されたサイズの影を実ROMのエフェクト表から読む", () => {
    const { rom, offsets } = load();
    const sprites = OverworldSprites.read(rom, offsets.overworldGraphicsTablePointer, offsets.overworldPaletteTablePointer);
    const effects = OverworldEffects.read(rom, offsets.fieldEffectTemplateTablePointer, sprites);
    const sizes = [[8, 8], [16, 8], [32, 8], [64, 32]];
    for (let id = 0; id < 152; id++) {
      const shadow = effects.shadow(id)!;
      expect(shadow, `影 ${id}`).not.toBeNull();
      expect([shadow.width, shadow.height]).toEqual(sizes[sprites.info(id)!.shadowSize]);
      expect(shadow.data.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
    }
  });
});

describe.skipIf(!romPath)("実 ROM: 種族名の読み（#447。ZIGZAGU_TEST_ROM）", () => {
  it("全部の種族名が、自分のひらがなとローマ字の読みで当たる", () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const names = SpeciesNameTable.read(rom, requireSupportedGame(rom).offsets.speciesNameTablePointer);
    for (let i = 1; i < SPECIES_COUNT; i++) {
      const name = names.name(i)!;
      const tokens = readingTokens(name);
      expect(matchReading(normalizeReading(toHiragana(name)), tokens), `${i} ${name}`).toBe(2);
      expect(matchReading(normalizeReading(romajiReading(name)), tokens), `${i} ${name} ${romajiReading(name)}`).toBe(2);
    }
  });
});
