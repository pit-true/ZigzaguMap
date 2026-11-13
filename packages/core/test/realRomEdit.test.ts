import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AddConnectionCommand,
  AddEventCommand,
  AddMapScriptCommand,
  AddMapScriptConditionCommand,
  CfruProject,
  CommandBus,
  CreateMapCommand,
  MapSourceConverter,
  MapSourceJson,
  MoveEventCommand,
  RemapBlockPalettesCommand,
  RemoveConnectionCommand,
  RemoveEventCommand,
  ResizeMapCommand,
  SetBlockCommand,
  SetBlockCountCommand,
  SetBorderCommand,
  SetConnectionCommand,
  SetEventCountsCommand,
  SetEventFieldsCommand,
  SetHeaderFieldsCommand,
  SetItemBallCommand,
  SetMapNameCommand,
  SetMapScriptCommand,
  SetPaletteColorsCommand,
  SetTilesCommand,
  SetTilesetsCommand,
  SetWildAreasCommand,
  SetWildRateCommand,
  SetWildSlotCommand,
  createDefaultRegistry,
  encodeBase64,
  type Command,
  type MapId,
  type TilesetRef,
} from "../src/index.js";
import { NodeProjectFs } from "../src/node/index.js";

/** 素の BPRJ のパス。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;
/** 指定すると、全コマンドを実行して保存した maps\ をこのフォルダに残す（ビルド側の検査用）。 */
const keepDir = process.env.ZIGZAGU_KEEP_OUTPUT;

const PALLET: MapId = { bank: 3, map: 0 };
const ROUTE1: MapId = { bank: 3, map: 19 };
const HOUSE: MapId = { bank: 4, map: 1 };
const ROUTE: MapId = { bank: 3, map: 45 };
const TOUCHED = [PALLET, ROUTE1, HOUSE, ROUTE];

/** 実マップに対して全種類のコマンドを並べる。 */
function commands(project: CfruProject, primary: TilesetRef, secondary: TilesetRef): Command[] {
  const counts = project.bankCounts();
  const t = { tileset: primary.pointer, secondary: false };
  const s = { tileset: secondary.pointer, secondary: true };
  return [
    new AddEventCommand({ ...PALLET, kind: "person", x: 5, y: 5 }),
    new SetEventFieldsCommand({ ...PALLET, kind: "person", index: 3, fields: { graphicsId: 23, movementType: 2, script: 0x0816f884, flag: 0x40 } }),
    new MoveEventCommand({ ...PALLET, kind: "warp", index: 0, x: 7, y: 7 }),
    new SetEventFieldsCommand({ ...PALLET, kind: "sign", index: 0, fields: { kind: 7, item: 13, flag: 0x10, amount: 1 } }),
    new RemoveEventCommand({ ...PALLET, kind: "sign", index: 4 }),
    new SetEventCountsCommand({ ...HOUSE, persons: 2, traps: 1 }),
    new SetItemBallCommand({ ...PALLET, personIndex: 3, itemId: 4, id: "0123456789abcdef0123456789abcdef" }),
    new SetHeaderFieldsCommand({ ...PALLET, fields: { music: 0x111, weather: 3, allowRunning: false } }),
    new SetMapNameCommand({ regionId: 0x58, text: "マサラタウンX" }),
    new ResizeMapCommand({ ...ROUTE1, width: 30, height: 44 }),
    new SetBorderCommand({ ...ROUTE1, width: 2, height: 2, cells: [1, 2, 3, 4] }),
    new SetTilesetsCommand({ ...HOUSE, primary: project.tilesetTable.pointerOf(0)!, secondary: project.tilesetTable.pointerOf(1)! }),
    new AddMapScriptCommand({ ...PALLET, type: 3, pointer: 0x0816f58d }),
    new SetMapScriptCommand({ ...PALLET, index: 0, pointer: 0x0816f58e }),
    new AddMapScriptConditionCommand({ ...PALLET, index: 1, variable: 0x4051, value: 1, script: 0x0816f600 }),
    new AddConnectionCommand({ ...PALLET, direction: 3, targetBank: 3, targetMap: 1 }),
    new SetConnectionCommand({ ...PALLET, index: 0, offset: 2 }),
    new RemoveConnectionCommand({ ...PALLET, index: 1 }),
    new SetWildRateCommand({ ...ROUTE1, area: 0, rate: 30 }),
    new SetWildSlotCommand({ ...ROUTE1, area: 0, slot: 0, minLevel: 7, maxLevel: 9, species: 26 }),
    new SetWildAreasCommand({ ...HOUSE, areas: [true, false, false, true] }),
    new SetWildAreasCommand({ ...ROUTE, areas: [true, false, true, false] }),
    new CreateMapCommand({ bank: 3, map: counts[3]!, width: 12, height: 10, primaryTileset: primary.pointer, secondaryTileset: secondary.pointer, templateBank: 3, templateMap: 0 }),
    new CreateMapCommand({ bank: counts.length, map: 0, width: 8, height: 8, primaryTileset: primary.pointer, secondaryTileset: secondary.pointer }),
    new SetBlockCommand({ ...t, block: 1, tiles: [0x3c12, 1, 2, 3, 0, 0, 0, 0], attribute: 0x20000084 }),
    new SetPaletteColorsCommand({ ...t, palette: 0, start: 9, colors: [0x001f] }),
    new SetTilesCommand({ ...s, start: 3, data: encodeBase64(new Uint8Array(64).fill(0x31)) }),
    new SetBlockCountCommand({ ...s, count: 100 }),
    new RemapBlockPalettesCommand({ ...s, mapping: [0, 1, 2, 3, 4, 5, 6, 8, 7, 9, 10, 11, 12, 13, 14, 15] }),
  ];
}

/** 読み込み済みのマップの JSON（番号 → 文字列）。 */
function mapJsons(project: CfruProject, ids: readonly MapId[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const doc = project.loaded(id);
    if (doc) out.set(`${id.bank}.${id.map}`, MapSourceJson.stringify(MapSourceConverter.toSource(doc)));
  }
  return out;
}

describe.skipIf(!romPath)("実 ROM: 編集コマンド → 保存 → 開き直し（ZIGZAGU_TEST_ROM）", () => {
  it("全種類のコマンドを実行して保存し、開き直すと同じ。全部アンドゥすると JSON が消える", async () => {
    const romBytes = new Uint8Array(readFileSync(romPath!));
    const dir = mkdtempSync(join(tmpdir(), "zigzagu-edit-"));
    try {
      const project = await CfruProject.open(romBytes, new NodeProjectFs(dir));
      for (const id of TOUCHED) await project.load(id);
      const pallet = project.loaded(PALLET)!;
      expect(pallet.mapNameText()).toBe("マサラタウン");
      const primary = { pointer: pallet.primaryTileset, secondary: false };
      const secondary = { pointer: pallet.secondaryTileset, secondary: true };
      await project.loadTilesetDocument(primary);
      await project.loadTilesetDocument(secondary);
      const ctx = project.editorContext();
      const bus = new CommandBus(ctx);
      const list = commands(project, primary, secondary);
      for (const command of list) bus.execute(command);
      expect(bus.history()).toHaveLength(list.length);

      const ids = project.mapIds();
      const saved = await project.save();
      expect(saved.written).toContain("maps/project.json");
      expect(saved.written).toContain("assembly/overworld_scripts/HiddenItem.s");
      expect(saved.written.filter((p) => p.startsWith("maps/tilesets/"))).toHaveLength(4);
      expect(await project.save()).toEqual({ written: [], removed: [] });

      // 開き直して、読んだマップとタイルセットが同じか。
      const reopened = await CfruProject.open(romBytes, new NodeProjectFs(dir));
      const before = mapJsons(project, ids);
      for (const id of ids) if (project.loaded(id)) await reopened.load(id);
      expect(mapJsons(reopened, ids)).toEqual(before);
      for (const ref of [primary, secondary]) {
        expect((await reopened.loadTilesetDocument(ref)).toJson()).toBe(ctx.tileset(ref).toJson());
      }
      expect(reopened.bankCounts()).toEqual(project.bankCounts());
      expect(reopened.loaded(PALLET)!.mapNameText()).toBe("マサラタウンX");
      expect(await reopened.save()).toEqual({ written: [], removed: [] });

      // 全部アンドゥして保存すると、マップとタイルセットのファイルが消える。
      while (bus.undo());
      expect(project.hasUnsavedChanges()).toBe(true);
      const undone = await project.save();
      expect(undone.written).toEqual(["assembly/overworld_scripts/HiddenItem.s"]);
      expect(project.hasUnsavedChanges()).toBe(false);
      const left = readdirSync(join(dir, "maps"), { recursive: true }).map(String).filter((p) => p.endsWith(".json") || p.endsWith(".png"));
      expect(left).toEqual(["project.json"]);
      for (const id of TOUCHED) expect(project.isModified(id)).toBe(false);

      // 出力をビルド側の検査用に残す（操作列を JSON から再生して作る）。
      if (keepDir) {
        rmSync(keepDir, { recursive: true, force: true });
        mkdirSync(keepDir, { recursive: true });
        const kept = await CfruProject.open(romBytes, new NodeProjectFs(keepDir));
        for (const id of TOUCHED) await kept.load(id);
        await kept.loadTilesetDocument(primary);
        await kept.loadTilesetDocument(secondary);
        const replay = new CommandBus(kept.editorContext());
        const registry = createDefaultRegistry();
        for (const record of list.map((c) => JSON.parse(JSON.stringify({ name: c.name, args: c.args })))) replay.execute(registry.create(record));
        await kept.save();
        expect(mapJsons(kept, ids)).toEqual(before);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
