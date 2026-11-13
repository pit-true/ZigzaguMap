import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CfruProject,
  DocumentStore,
  MemoryProjectFs,
  REGION_MAP_PATH,
  RegionMapJson,
  RegionMapProject,
  RegionMapReader,
  Rom,
  CommandBus,
  createDefaultRegistry,
  formatRomOffset,
  withRegionMap,
  type RgbaImage,
} from "../src/index.js";

/** 実 ROM のパス。設定されていなければこのファイルのテストは飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;
/** 地図の PNG を書き出すフォルダ（目で確かめる用。設定されていなければ書かない）。 */
const pngDir = process.env.ZIGZAGU_REGION_MAP_PNG_DIR;

describe.skipIf(!romPath)("実 ROM: タウンマップ（ZIGZAGU_TEST_ROM）", () => {
  const rom = () => new Rom(new Uint8Array(readFileSync(romPath!)));

  it("4 面 × 2 レイヤーの地名の表を読む（AdvanceMap と同じ位置の値）", () => {
    const { document: doc, addresses } = RegionMapReader.read(rom(), "BPRJ");
    expect(addresses.layouts).toEqual([0x3b9018, 0x3b92ac, 0x3b9540, 0x3b97d4]);
    // AdvanceMap の F09-03/F09-04: (4,11) マサラタウン、(8,6) 16ばん どうろ、(10,3) 4ばん どうろ、区画なしは C5。
    expect(doc.cell(0, 0, 4, 11)).toBe(0x58);
    expect(doc.cell(0, 0, 8, 6)).toBe(0x74);
    expect(doc.cell(0, 0, 10, 3)).toBe(0x68);
    expect(doc.cell(0, 0, 0, 0)).toBe(0xc5);
    // ななしまの各面にも街がある（1のしま 0x8F、4のしま 0x92、6のしま 0x94 はどれかの面に 1 つ）。
    for (const id of [0x8f, 0x90, 0x91, 0x92, 0x93, 0x94, 0x95]) expect(doc.find(id, 0), `地名 ${id.toString(16)}`).not.toBeNull();
    expect(doc.find(0x8f, 0)!.page).toBe(1);
    expect(doc.find(0x92, 0)!.page).toBe(2);
    expect(doc.find(0x94, 0)!.page).toBe(3);
    // 洞窟のレイヤー（トップレイヤー）にはトキワのもり（0x7E）がある。
    expect(doc.find(0x7e, 1)).not.toBeNull();
  });

  it("位置・名前・空を飛ぶ・飛び先・人ID（AdvanceMap の表示と同じ）", () => {
    const { document: doc, addresses } = RegionMapReader.read(rom(), "BPRJ");
    expect(doc.section(0x58)).toEqual({ x: 4, y: 11, width: 1, height: 1 });
    expect(doc.section(0x5d)).toMatchObject({ x: 14, y: 9 });
    expect(doc.section(0x74)).toMatchObject({ x: 7, y: 6 });
    expect(doc.section(0x68)).toMatchObject({ x: 8, y: 3 });
    // ポジションの保存で変わった位置（0x3B8A58 = 16ばん どうろの X）。
    expect(addresses.positions + (0x74 - 0x58) * 4).toBe(0x3b8a58);
    expect(formatRomOffset(addresses.nameStrings[0]!)).toBe("$3B5A48");
    expect(formatRomOffset(addresses.nameStrings[0x5d - 0x58]!)).toBe("$3B5A6A");
    expect(formatRomOffset(addresses.nameStrings[0x74 - 0x58]!)).toBe("$3B5B27");
    expect(formatRomOffset(addresses.nameStrings[0x68 - 0x58]!)).toBe("$3B5AC1");
    expect(doc.flyDestination(0x58)).toEqual({ bank: 3, map: 0, heal: 1 });
    expect(doc.flyDestination(0x5d)).toEqual({ bank: 3, map: 5, heal: 6 });
    expect(doc.flyDestination(0x74)).toEqual({ bank: 3, map: 0x22, heal: 0 });
    expect(doc.flyDestination(0x68)).toEqual({ bank: 3, map: 0x16, heal: 0 });
    expect(doc.healLocation(1)).toEqual({ bank: 3, map: 0, x: 6, y: 8 });
    expect(doc.healLocation(6)).toEqual({ bank: 3, map: 5, x: 15, y: 7 });
    expect(doc.flag(0, 0x58)).toBe(0x890);
    expect(doc.flag(0, 0x5d)).toBe(0x895);
    expect(doc.flag(0, 0x74)).toBe(0xffff);
    expect(doc.flag(0, 0xc5)).toBe(0xffff);
    // 道路のポケセン（4ばん どうろ）は別の条件の後に EventFlagCheck を呼ぶ。
    expect(doc.flag(0, 0x63)).toBe(0x8a2);
    // 洞窟の訪問フラグ（GetCaveState）。
    expect(doc.flag(1, 0x7e)).not.toBe(0xffff);
  });

  it("地図の絵を読み、4 面を PNG にできる", () => {
    const { graphics } = RegionMapReader.read(rom(), "BPRJ");
    expect(graphics.data.palette).toHaveLength(80);
    expect(graphics.data.tiles).toHaveLength(320 * 32);
    expect(graphics.data.screens).toHaveLength(4);
    for (let page = 0; page < 4; page++) {
      const image = graphics.render(page);
      expect(image.width).toBe(240);
      expect(image.height).toBe(160);
      // 色が何種類もある（真っ黒・真っ白ではない）。
      const colors = new Set<number>();
      for (let i = 0; i < image.data.length; i += 4) colors.add((image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!);
      expect(colors.size).toBeGreaterThan(10);
      if (pngDir) {
        mkdirSync(pngDir, { recursive: true });
        writeFileSync(join(pngDir, `page${page + 1}.png`), rgbaPng(image));
      }
    }
  });

  it("コマンドで変え、regionmap.json に書き、読み直して同じになる", async () => {
    const fs = new MemoryProjectFs();
    const bytes = new Uint8Array(readFileSync(romPath!));
    const project = await CfruProject.open(bytes, fs);
    const region = await RegionMapProject.open(project.rom, "BPRJ", fs);
    const bus = new CommandBus(withRegionMap(project.editorContext(), () => region.document));
    const registry = createDefaultRegistry();
    bus.execute(registry.create({ name: "setRegionSection", args: { id: 0x74, x: 5, y: 7, flyHeal: 3, healIndex: 3, healX: 20 } }));
    bus.execute(registry.create({ name: "setRegionCells", args: { page: 0, layer: 0, cells: [{ x: 1, y: 1, value: 0x74 }] } }));
    bus.execute(registry.create({ name: "setRegionFlag", args: { layer: 0, id: 0x74, flag: 0x8ff } }));
    expect(region.isModified()).toBe(true);
    const saved = await region.save(fs);
    expect(saved.written).toEqual([REGION_MAP_PATH]);
    expect(region.isModified()).toBe(false);
    const text = fs.files.get(REGION_MAP_PATH) as string;
    expect(text).toContain('"Positions"');
    expect(text).not.toContain('"Sizes"');
    expect(text).toContain('"Page": "kanto"');

    const reopened = await RegionMapProject.open(project.rom, "BPRJ", fs);
    expect(reopened.document.equals(region.document)).toBe(true);
    expect(reopened.document.section(0x74)).toMatchObject({ x: 5, y: 7 });
    expect(reopened.document.cell(0, 0, 1, 1)).toBe(0x74);
    expect(reopened.document.flag(0, 0x74)).toBe(0x8ff);
    expect(reopened.document.healLocation(3)!.x).toBe(20);

    // すべて取り消すとベース ROM と同じになり、保存でファイルが消える。
    while (bus.undo());
    expect(region.document.equals(region.base)).toBe(true);
    expect(RegionMapJson.stringify(region.document, region.base)).toBeNull();
    expect((await region.save(fs)).removed).toEqual([REGION_MAP_PATH]);
    expect(await fs.exists(REGION_MAP_PATH)).toBe(false);
  });

  it("名前の変更は既存のマップ名の編集として扱い、取り消せる", async () => {
    const store = new DocumentStore();
    const region = await RegionMapProject.open(rom(), "BPRJ", null);
    const bus = new CommandBus(withRegionMap(store, () => region.document));
    bus.execute(createDefaultRegistry().create({ name: "setRegionSection", args: { id: 0x74, name: "テスト" } }));
    expect(store.textCodec.decode(store.mapNameEdit(0x74)!)).toBe("テスト");
    bus.undo();
    expect(store.mapNameEdit(0x74)).toBeNull();
    bus.redo();
    expect(store.mapNameEdit(0x74)).not.toBeNull();
  });
});

/** RGBA の画像を PNG にする（テストの確認用）。 */
function rgbaPng(image: RgbaImage): Uint8Array {
  const raw = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw[y * (image.width * 4 + 1)] = 0;
    Buffer.from(image.data.buffer, y * image.width * 4, image.width * 4).copy(raw, y * (image.width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(data: Buffer): number {
  let c = ~0;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}
