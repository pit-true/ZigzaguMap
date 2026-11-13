import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_SIZE,
  CfruProject,
  ConnectionReader,
  EventReader,
  MAP_NAME_COUNT,
  MAP_NAME_FIRST_ID,
  MapScriptReader,
  MapSourceConverter,
  MapSourceJson,
  MemoryProjectFs,
  PERSON_SIZE,
  ROM_BASE,
  Rom,
  RomMapSource,
  SIGN_SIZE,
  TRAP_SIZE,
  TextCodec,
  WARP_SIZE,
  WILD_AREA_COUNT,
  WILD_HEADER_SIZE,
  WILD_INFO_SIZE,
  WILD_SLOT_COUNTS,
  WILD_SLOT_SIZE,
  connectionCodec,
  connectionHeaderCodec,
  eventHeaderCodec,
  mapHeaderCodec,
  mapScriptCodec,
  mapSourcePath,
  personCodec,
  requireSupportedGame,
  signCodec,
  trapCodec,
  warpCodec,
  wildHeaderCodec,
  wildInfoCodec,
  wildSlotCodec,
} from "../src/index.js";
import { NodeProjectFs } from "../src/node/index.js";

/** 素の BPRJ のパス。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;
/** ND のベース ROM と NeoDark-CFRU のフォルダ。 */
const ndRomPath = process.env.ZIGZAGU_TEST_ND_ROM;
const ndProject = process.env.ZIGZAGU_TEST_ND_PROJECT;

describe.skipIf(!romPath)("実 ROM: イベント・接続・マップスクリプト・野生・マップ名（ZIGZAGU_TEST_ROM）", () => {
  // describe の中身は飛ばすときも実行されるため、ROM は各テストの中で初めて読む。
  let cache: { rom: Rom; source: RomMapSource; ids: { bank: number; map: number }[] } | null = null;
  const load = () => {
    if (!cache) {
      const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
      const source = new RomMapSource(rom, requireSupportedGame(rom).offsets);
      cache = { rom, source, ids: [...source.bankTable.ids()] };
    }
    return cache;
  };
  const at = (pointer: number) => pointer - ROM_BASE;

  it("全マップの構造体が decode → encode で元のバイト列に戻る", () => {
    const { rom, source, ids } = load();
    const events = new EventReader(rom);
    const connections = new ConnectionReader(rom);
    const scripts = new MapScriptReader(rom);
    let counts = { events: 0, connections: 0, scripts: 0, tables: 0 };
    for (const id of ids) {
      const headerAt = source.bankTable.headerOffset(id);
      const headerRaw = rom.slice(headerAt, 28);
      const header = mapHeaderCodec.decode(headerRaw);
      expect(mapHeaderCodec.encode(header)).toEqual(headerRaw);

      if (header.events) {
        const raw = rom.slice(at(header.events), 20);
        const h = eventHeaderCodec.decode(raw);
        expect(eventHeaderCodec.encode(h)).toEqual(raw);
        const lists: [typeof personCodec | typeof warpCodec | typeof trapCodec | typeof signCodec, number, number, number][] = [
          [personCodec, h.persons, h.personCount, PERSON_SIZE],
          [warpCodec, h.warps, h.warpCount, WARP_SIZE],
          [trapCodec, h.traps, h.trapCount, TRAP_SIZE],
          [signCodec, h.signs, h.signCount, SIGN_SIZE],
        ];
        for (const [codec, pointer, count, size] of lists) {
          const bytes = events.rawList(pointer, count, size);
          const list = (codec.decodeAll as (b: Uint8Array) => unknown[])(bytes);
          expect((codec.encodeList as (v: unknown[]) => Uint8Array)(list)).toEqual(bytes);
        }
        counts.events++;
      }
      if (header.connections) {
        const raw = rom.slice(at(header.connections), 8);
        const h = connectionHeaderCodec.decode(raw);
        expect(connectionHeaderCodec.encode(h)).toEqual(raw);
        const bytes = connections.rawList(h);
        expect(bytes.length).toBe(h.count * CONNECTION_SIZE);
        expect(connectionCodec.encodeList(connectionCodec.decodeAll(bytes))).toEqual(bytes);
        counts.connections++;
      }
      if (header.scripts) {
        const raw = scripts.readRaw(at(header.scripts));
        expect(mapScriptCodec.encodeList(mapScriptCodec.decodeList(raw.list))).toEqual(raw.list);
        for (const table of raw.tables.values()) {
          expect(mapScriptCodec.encodeTable(mapScriptCodec.decodeTable(table))).toEqual(table);
          counts.tables++;
        }
        counts.scripts++;
      }
    }
    expect(counts.events).toBeGreaterThan(300);
    expect(counts.connections).toBeGreaterThan(50);
    expect(counts.scripts).toBeGreaterThan(100);
    expect(counts.tables).toBeGreaterThan(50);
  });

  it("野生ヘッダー表の全件が decode → encode で元に戻る", () => {
    const { rom, source } = load();
    const table = source.wildTable;
    expect(table.entries.length).toBeGreaterThan(100);
    for (const entry of table.entries) {
      const raw = rom.slice(entry.offset, WILD_HEADER_SIZE);
      expect(wildHeaderCodec.encode(entry.header)).toEqual(raw);
      for (let area = 0; area < WILD_AREA_COUNT; area++) {
        const pointer = entry.header.areas[area]!;
        if (!pointer) continue;
        const infoRaw = rom.slice(at(pointer), WILD_INFO_SIZE);
        const info = wildInfoCodec.decode(infoRaw);
        expect(wildInfoCodec.encode(info)).toEqual(infoRaw);
        const slotsRaw = rom.slice(at(info.slots), WILD_SLOT_COUNTS[area]! * WILD_SLOT_SIZE);
        expect(wildSlotCodec.encodeList(wildSlotCodec.decodeAll(slotsRaw))).toEqual(slotsRaw);
      }
    }
  });

  it("マップ名表の全件が文字列と元のバイト列の間で往復する", () => {
    const { source } = load();
    const names = source.nameTable;
    const codec = TextCodec.japanese;
    for (let id = MAP_NAME_FIRST_ID; id < MAP_NAME_FIRST_ID + MAP_NAME_COUNT; id++) {
      const raw = names.rawName(id)!;
      const text = codec.decode(raw);
      expect(codec.encode(text)).toEqual(raw);
    }
    expect(names.name(0x58)).toBe("マサラタウン");
  });

  it("全マップを MapDocument → JSON → MapDocument と往復しても変わらない", () => {
    const { source, ids } = load();
    for (const id of ids) {
      const doc = source.read(id);
      const json = MapSourceJson.stringify(MapSourceConverter.toSource(doc));
      const back = MapSourceConverter.fromSource(MapSourceJson.parse(json));
      expect(MapSourceJson.stringify(MapSourceConverter.toSource(back))).toBe(json);
      expect(back.grid.cells).toEqual(doc.grid.cells);
      expect(back.events).toEqual(doc.events);
      expect(back.connections).toEqual(doc.connections);
      expect(back.mapScripts).toEqual(doc.mapScripts);
      expect(back.wild).toEqual(doc.wild);
      expect(back.header).toEqual(doc.header);
    }
  });

  it("ROM から読んだままのマップは変更なしと判定され、JSON を書かない", async () => {
    const { rom } = load();
    const fs = new MemoryProjectFs();
    const project = await CfruProject.open(rom.bytes, fs);
    for (const id of project.mapIds()) {
      const doc = await project.load(id);
      expect(project.differsFromBase(doc)).toBe(false);
      expect(project.isModified(id)).toBe(false);
    }
    expect(await project.save()).toEqual({ written: [], removed: [] });
    expect(fs.files.size).toBe(0);
  });

  it("推定したマップ数が ND の project.json と同じ", () => {
    const { source } = load();
    const counts = source.bankTable.counts();
    expect(counts.slice(0, 5)).toEqual([5, 123, 60, 66, 4]);
    expect(counts.length).toBe(43);
  });
});

describe.skipIf(!ndRomPath || !ndProject)("ND のベース ROM と maps\\（ZIGZAGU_TEST_ND_ROM / ZIGZAGU_TEST_ND_PROJECT）", () => {
  it("マップ 3.0 が JSON から読め、書き戻すと元のファイルと同じ", async () => {
    const fs = new NodeProjectFs(ndProject!);
    const project = await CfruProject.open(new Uint8Array(readFileSync(ndRomPath!)), fs);
    const id = { bank: 3, map: 0 };
    expect(project.hasJson(id)).toBe(true);
    const doc = await project.load(id);
    expect(doc.mapNameText()).toBe("マサラタウン");
    const text = await fs.readText(mapSourcePath(id));
    expect(MapSourceJson.stringify(MapSourceConverter.toSource(doc))).toBe(text);
    const tilesets = await project.loadTilesets(doc);
    expect(tilesets.primary.tiles.length).toBeGreaterThan(0);
  });

  it("書き出しは一時フォルダで行い、読み込んだだけなら何も変えない", async () => {
    const temp = mkdtempSync(join(tmpdir(), "zigzagu-nd-"));
    try {
      const fs = new NodeProjectFs(temp);
      await fs.writeText("maps/project.json", await new NodeProjectFs(ndProject!).readText("maps/project.json"));
      await fs.writeText("maps/03/00.json", await new NodeProjectFs(ndProject!).readText("maps/03/00.json"));
      const project = await CfruProject.open(new Uint8Array(readFileSync(ndRomPath!)), fs);
      const doc = await project.load({ bank: 3, map: 0 });
      await project.load({ bank: 3, map: 1 });
      // 3.0 はベースと違い（人を 1 人足してある）、ファイルと同じ内容なので書きも消しもしない。
      // 3.1 は ROM から読んだままなので書かない。
      expect(project.differsFromBase(doc)).toBe(true);
      expect(await project.save()).toEqual({ written: [], removed: [] });
      expect(readdirSync(join(temp, "maps")).sort()).toEqual(["03", "project.json"]);

      // 人を消すとベースと同じに戻り、JSON が消える。
      doc.events!.persons = [];
      expect(await project.save()).toEqual({ written: [], removed: ["maps/03/00.json"] });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
