import { describe, expect, it } from "vitest";
import { BPRJ_OFFSETS, CommandBus, GridStore, MapDocument, PlaceBlockCommand, Rom, RomMapSource, renderMap } from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

describe("MapDocument（合成 ROM）", () => {
  const source = new RomMapSource(new Rom(buildSyntheticRom()), BPRJ_OFFSETS);

  it("ROM から全項目を読む", () => {
    const doc = MapDocument.fromRom(source, { bank: 0, map: 0 });
    expect(doc.header.music).toBe(0x100);
    expect(doc.header.floorNum).toBe(-1);
    expect(doc.width).toBe(2);
    expect(doc.mapNameText()).toBe("マサラ");
    expect(doc.events!.signs[1]!.content.type).toBe("hiddenItem");
    expect(doc.connections).toHaveLength(1);
    // 条件表のポインタは表の位置のまま読む（場所の設定で見せる。出力では 0 にする）
    expect(doc.mapScripts![1]!.pointer).toBeGreaterThan(0x08000000);
    expect(doc.mapScripts![1]!.table!.entries).toHaveLength(1);
    expect(doc.wild).toHaveLength(1);
    // 表の無いマップは null。
    const other = source.read({ bank: 0, map: 1 });
    expect(other.events).toBeNull();
    expect(other.connections).toBeNull();
    expect(other.mapScripts).toBeNull();
    expect(other.wild).toEqual([]);
  });

  it("clone は深いコピー", () => {
    const doc = source.read({ bank: 0, map: 0 });
    const copy = doc.clone();
    copy.grid.setBlock(0, 0, 5);
    copy.events!.persons[0]!.x = 9;
    expect(doc.grid.getBlock(0, 0)).toBe(1);
    expect(doc.events!.persons[0]!.x).toBe(3);
  });

  it("マップ名を文字列で変えられる", () => {
    const doc = source.read({ bank: 0, map: 0 });
    doc.setMapNameText("トキワ");
    expect(doc.mapNameText()).toBe("トキワ");
  });

  it("GridStore から MapDocument の配置を直接編集できる", () => {
    const doc = source.read({ bank: 0, map: 0 });
    const bus = new CommandBus(GridStore.forDocuments(() => doc));
    bus.execute(new PlaceBlockCommand({ bank: 0, map: 0, x: 0, y: 1, block: 9 }));
    expect(doc.grid.getBlock(0, 1)).toBe(9);
    bus.undo();
    expect(doc.grid.getBlock(0, 1)).toBe(640);
  });

  it("タイルセットを読んで描画できる", () => {
    const doc = source.read({ bank: 0, map: 0 });
    const image = renderMap(doc.toRenderable(source.readTileset(doc.primaryTileset, false), source.readTileset(doc.secondaryTileset, true)));
    expect(image.width).toBe(32);
  });
});
