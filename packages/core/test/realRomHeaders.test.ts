import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CfruProject, MemoryProjectFs, RomLocations, toHexBytes, type MapId } from "../src/index.js";

/** 実 ROM のパス。設定されていなければこのファイルのテストは飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;

/**
 * AdvanceMap 1.92 の「場所の設定」タブ（高度な表示）に出た値（素の BPRJ、2026-11-14 に harness で読んだもの）。
 * キーは AdvanceMap の部品名。
 */
const ADVANCEMAP: Record<string, Record<string, string>> = {
  "3.0": {
    Txt_MapBankHeader: "$316758",
    Txt_MapBank: "$3163A4",
    Txt_MapHeader: "$3146C8",
    Fld_Header: "70152A08808E370882F516081C6831082C014E005800020101060000",
    Txt_MapOffset: "$2A1570",
    Txt_EventOffset: "$378E80",
    Txt_MapScriptsOffset: "$16F582",
    Txt_AnbindungOffset: "$31681C",
    Fld_Footer: "1800000014000000A8112A08B0112A08448B29085C8B290802020000",
    Txt_Breite: "24",
    Txt_Hohe: "20",
    Txt_RandPos: "$2A11A8",
    Txt_MapPos: "$2A11B0",
    Txt_Tileset1Nr: "0",
    Txt_Tileset2Nr: "1",
    Txt_Tileset1: "$298B44",
    Txt_Tileset2: "$298B5C",
    Txt_RandBreite: "2",
    Txt_RandHoehe: "2",
    Txt_Rand: "1C001D0014001500",
    Fld_T1: "0100000024D722080400230878372608F9F80608785F2608",
    Fld_T2: "0101000004022308480623087869260800000000086F2608",
  },
  "4.1": {
    Txt_MapBankHeader: "$316758",
    Txt_MapBank: "$3164AC",
    Txt_MapHeader: "$314E1C",
    Fld_Header: "AC932908A4D73708D6BE1708000000002C0102005800000800000000",
    Txt_MapOffset: "$2993AC",
    Txt_EventOffset: "$37D7A4",
    Txt_MapScriptsOffset: "$17BED6",
    Txt_AnbindungOffset: "$000000",
    Fld_Footer: "0C00000009000000CC922908D4922908648C2908248D290802020000",
    Txt_Breite: "12",
    Txt_Hohe: "9",
    Txt_RandPos: "$2992CC",
    Txt_MapPos: "$2992D4",
    Txt_Tileset1Nr: "12",
    Txt_Tileset2Nr: "20",
    Txt_Tileset1: "$298C64",
    Txt_Tileset2: "$298D24",
    Txt_RandBreite: "2",
    Txt_RandHoehe: "2",
    Txt_Rand: "0800080008000800",
    Fld_T1: "010000001C8123081CA52308641827080000000064402708",
    Fld_T2: "01010000743524082C392408FC8E2708000000007C902708",
  },
  "1.1": {
    Txt_MapBankHeader: "$316758",
    Txt_MapBank: "$3160C8",
    Txt_MapHeader: "$3132E0",
    Fld_Header: "40E92B0898263708033C160800000000200172007F00000401070000",
    Txt_MapOffset: "$2BE940",
    Txt_EventOffset: "$372698",
    Txt_MapScriptsOffset: "$163C03",
    Txt_AnbindungOffset: "$000000",
    Fld_Footer: "300000002800000038DA2B0840DA2B08448B2908AC8C290802020000",
    Txt_Breite: "48",
    Txt_Hohe: "40",
    Txt_RandPos: "$2BDA38",
    Txt_MapPos: "$2BDA40",
    Txt_Tileset1Nr: "0",
    Txt_Tileset2Nr: "15",
    Txt_Tileset1: "$298B44",
    Txt_Tileset2: "$298CAC",
    Txt_RandBreite: "2",
    Txt_RandHoehe: "2",
    Txt_Rand: "9102910291029102",
    Fld_T1: "0100000024D722080400230878372608F9F80608785F2608",
    Fld_T2: "010100004CBD230830D02308DC90270800000000EC9A2708",
  },
  "3.37": {
    Txt_MapBankHeader: "$316758",
    Txt_MapBank: "$3163A4",
    Txt_MapHeader: "$314AD4",
    Fld_Header: "64832B08FCBB370879821708F06C310825016B007700020301060000",
    Txt_MapOffset: "$2B8364",
    Txt_EventOffset: "$37BBFC",
    Txt_MapScriptsOffset: "$178279",
    Txt_AnbindungOffset: "$316CF0",
    Fld_Footer: "180000003C0000001C782B0824782B08448B2908048C290802020000",
    Txt_Breite: "24",
    Txt_Hohe: "60",
    Txt_RandPos: "$2B781C",
    Txt_MapPos: "$2B7824",
    Txt_Tileset1Nr: "0",
    Txt_Tileset2Nr: "8",
    Txt_Tileset1: "$298B44",
    Txt_Tileset2: "$298C04",
    Txt_RandBreite: "2",
    Txt_RandHoehe: "2",
    Txt_Rand: "D901D901D901D901",
    Fld_T1: "0100000024D722080400230878372608F9F80608785F2608",
    Fld_T2: "01010000FC4C2308E458230864B926080000000064C52608",
  },
};

/** AdvanceMap のオフセット欄の書式（`$` + 6 桁。無いときは `$000000`）。 */
function offsetText(offset: number | null): string {
  return "$" + (offset ?? 0).toString(16).toUpperCase().padStart(6, "0");
}

/** 境界ブロックの欄（各マスを u16 のリトルエンディアンで並べた 16 進）。 */
function borderText(cells: Uint16Array): string {
  return toHexBytes(new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength));
}

describe.skipIf(!romPath)("ヘッダーの値が AdvanceMap の高度なヘッダー表示と同じ（ZIGZAGU_TEST_ROM）", () => {
  const open = async () => CfruProject.open(new Uint8Array(readFileSync(romPath!)), new MemoryProjectFs());

  for (const [key, expected] of Object.entries(ADVANCEMAP)) {
    it(key, async () => {
      const project = await open();
      const [bank, map] = key.split(".").map(Number) as [number, number];
      const id: MapId = { bank, map };
      const doc = await project.load(id);
      const locations = new RomLocations(project);
      const loc = locations.locations(id);
      const raw = locations.rawBytes(doc);
      const tileset = async (pointer: number, secondary: boolean) =>
        toHexBytes(locations.tilesetHeader(await project.loadTilesetDocument({ pointer, secondary })));
      const actual: Record<string, string> = {
        Txt_MapBankHeader: offsetText(loc.bankTable),
        Txt_MapBank: offsetText(loc.bankList),
        Txt_MapHeader: offsetText(loc.header),
        Fld_Header: toHexBytes(raw.header),
        Txt_MapOffset: offsetText(loc.layout),
        Txt_EventOffset: offsetText(loc.events),
        Txt_MapScriptsOffset: offsetText(loc.scripts),
        Txt_AnbindungOffset: offsetText(loc.connections),
        Fld_Footer: toHexBytes(raw.footer),
        Txt_Breite: String(doc.width),
        Txt_Hohe: String(doc.height),
        Txt_RandPos: offsetText(loc.border),
        Txt_MapPos: offsetText(loc.blocks),
        Txt_Tileset1Nr: String(project.tilesetTable.indexOf(doc.primaryTileset >>> 0)),
        Txt_Tileset2Nr: String(project.tilesetTable.indexOf(doc.secondaryTileset >>> 0)),
        Txt_Tileset1: offsetText((doc.primaryTileset >>> 0) - 0x08000000),
        Txt_Tileset2: offsetText((doc.secondaryTileset >>> 0) - 0x08000000),
        Txt_RandBreite: String(doc.border.width),
        Txt_RandHoehe: String(doc.border.height),
        Txt_Rand: borderText(doc.border.cells),
        Fld_T1: await tileset(doc.primaryTileset >>> 0, false),
        Fld_T2: await tileset(doc.secondaryTileset >>> 0, true),
      };
      expect(actual).toEqual(expected);
    });
  }
});
