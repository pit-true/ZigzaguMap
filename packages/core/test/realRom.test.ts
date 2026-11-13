import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MapLoader, Rom, renderMap, requireSupportedGame } from "../src/index.js";

/** 実 ROM のパス。設定されていなければこのファイルのテストは飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("実 ROM（ZIGZAGU_TEST_ROM）", () => {
  const load = () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const game = requireSupportedGame(rom);
    return { rom, game, loader: new MapLoader(rom, game.offsets) };
  };

  it("BPRJ と判定する", () => {
    const { game } = load();
    expect(game.code).toBe("BPRJ");
  });

  it("全バンクの全マップのヘッダーとレイアウトが例外なく読める", () => {
    const { loader } = load();
    let count = 0;
    for (const id of loader.bankTable.ids()) {
      const header = loader.readHeader(id);
      const layout = loader.readLayout(id);
      expect(layout.blocks.length).toBe(layout.width * layout.height);
      expect(header.layoutOffset).toBe(layout.offset);
      count++;
    }
    expect(loader.bankTable.bankCount).toBeGreaterThan(40);
    expect(count).toBeGreaterThan(300);
  });

  it("全マップのタイルセットが読める", () => {
    const { loader } = load();
    for (const id of loader.bankTable.ids()) {
      const map = loader.load(id);
      expect(map.primary.tiles.length).toBeGreaterThan(0);
      expect(map.secondary.tiles.length).toBeGreaterThan(0);
    }
  });

  it("マップ 3.0 を描画して空でない", () => {
    const { loader } = load();
    const map = loader.load({ bank: 3, map: 0 });
    const image = renderMap(map);
    expect(image.width).toBe(map.layout.width * 16);
    expect(image.height).toBe(map.layout.height * 16);
    const colors = new Set<number>();
    for (let i = 0; i < image.data.length; i += 4) {
      colors.add((image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!);
    }
    expect(colors.size).toBeGreaterThan(8);
  });

  it("AdvanceMap と同じく、下層の色 0 はそのパレットの色 0 で塗り、上層は色 0 と同じ色を抜く", () => {
    const { loader } = load();
    const pixel = (bank: number, map: number, x: number, y: number) => {
      const image = renderMap(loader.load({ bank, map }));
      const o = (y * image.width + x) * 4;
      return [image.data[o], image.data[o + 1], image.data[o + 2]];
    };
    // 1.1 の (4,21) の下端: 下層・上層とも色 0。下層のパレット 8 の色 0（水の色）になる。
    expect(pixel(1, 1, 65, 351)).toEqual([74, 115, 173]);
    // 0.0 の (0,7): 上層のパレット 10 の色 5 は色 0 と同じ黒なので抜け、下層が見える。
    expect(pixel(0, 0, 8, 121)).not.toEqual([0, 0, 0]);
  });
});
