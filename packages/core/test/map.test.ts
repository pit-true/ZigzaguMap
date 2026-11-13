import { describe, expect, it } from "vitest";
import { BPRJ_OFFSETS, MapLoader, Rom, RomError } from "../src/index.js";
import { MAP_CELLS, SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

describe("マップの読み取り（合成 ROM）", () => {
  const loader = new MapLoader(new Rom(buildSyntheticRom()), BPRJ_OFFSETS);

  it("バンク表のマップ数を推定する", () => {
    const table = loader.bankTable;
    expect(table.offset).toBe(SYN.bankTable);
    expect(table.bankCount).toBe(2);
    expect(table.mapCount(0)).toBe(2);
    expect(table.mapCount(1)).toBe(1);
    expect(table.mapCount(5)).toBe(0);
    expect([...table.ids()]).toEqual([
      { bank: 0, map: 0 },
      { bank: 0, map: 1 },
      { bank: 1, map: 0 },
    ]);
  });

  it("マップヘッダーを読む", () => {
    const h = loader.readHeader({ bank: 0, map: 1 });
    expect(h.offset).toBe(SYN.headers + 28);
    expect(h.layoutOffset).toBe(SYN.footer);
    expect(h.eventsOffset).toBeNull();
    expect(h.music).toBe(0x101);
    expect(h.layoutId).toBe(1);
    expect(h.regionMapSectionId).toBe(0x58);
    expect(h.weather).toBe(2);
    expect(h.mapType).toBe(1);
    expect(h.floorNum).toBe(-1);
  });

  it("フッターと配置・ボーダーを読む", () => {
    const l = loader.readLayout({ bank: 1, map: 0 });
    expect(l.width).toBe(2);
    expect(l.height).toBe(2);
    expect(l.primaryTilesetOffset).toBe(SYN.primaryHeader);
    expect(l.secondaryTilesetOffset).toBe(SYN.secondaryHeader);
    expect([...l.blocks]).toEqual([...MAP_CELLS]);
    expect(l.borderWidth).toBe(2);
    expect([...l.border]).toEqual([1, 1, 1, 1]);
  });

  it("タイルセットを読む（圧縮・非圧縮）", () => {
    const map = loader.load({ bank: 0, map: 0 });
    expect(map.primary.header.isCompressed).toBe(true);
    expect(map.primary.tiles.length).toBe(4 * 32);
    expect(map.primary.blocks.length).toBe(640 * 8);
    expect(map.primary.attributes[1]).toBe(0x20000001);
    expect(map.secondary.header.isSecondary).toBe(true);
    expect(map.secondary.tiles.length).toBe(384 * 32);
    expect(map.secondary.blocks.length).toBe(384 * 8);
    expect(map.secondary.palettes.length).toBe(256);
  });

  it("同じタイルセットは使い回す", () => {
    const a = loader.load({ bank: 0, map: 0 });
    const b = loader.load({ bank: 1, map: 0 });
    expect(a.primary).toBe(b.primary);
  });

  it("無いマップは RomError", () => {
    expect(() => loader.readHeader({ bank: 0, map: 2 })).toThrow(RomError);
  });

  it("壊れた大きさは RomError", () => {
    const bytes = buildSyntheticRom();
    bytes[SYN.footer] = 0;
    const broken = new MapLoader(new Rom(bytes), BPRJ_OFFSETS);
    expect(() => broken.readLayout({ bank: 0, map: 0 })).toThrow(RomError);
  });
});
