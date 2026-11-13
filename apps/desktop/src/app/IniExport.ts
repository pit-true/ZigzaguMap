import { buildMapTree, SORT_BY_NAME_AND_TILESET } from "./MapTreeModel";
import type { MapCatalog } from "./MapCatalog";
import { encodeShiftJis } from "./shiftJis";

/** 書き出すファイル（AdvanceMap と同じ名前）。 */
export const NEW_MAIN_INI = "NewMain.ini";
export const NEW_MAPS_INI = "NewMaps.ini";

/**
 * 設定 > マップの表示設定 > ヘッダーから新たなIniファイルを作る。AdvanceMap と同じ形の 2 つの ini を作る。
 * - NewMain.ini: マップ名ごとの節に「番号=バンク.マップ」を並べる（「マップとタイルセットで並び替え」の順。マップの無い名前は出さない）
 * - NewMaps.ini: 「[バンク.マップ]」の節に「Name=マップ名 補足」
 * 文字コードは Shift_JIS、改行は CRLF。
 */
export function buildNewIni(catalog: MapCatalog): { main: Uint8Array; maps: Uint8Array } {
  const header = buildMapTree(catalog, SORT_BY_NAME_AND_TILESET, "header")[0]!;
  const main: string[] = [];
  const maps: string[] = [];
  for (const group of header.children ?? []) {
    const children = (group.children ?? []).filter((c) => c.mapId);
    if (children.length === 0) continue;
    main.push(`[${group.label}]`);
    children.forEach((c, i) => {
      const id = `${c.mapId!.bank}.${c.mapId!.map}`;
      main.push(`${i}=${id}`);
      maps.push(`[${id}]`, `Name=${c.label.replace(/ \(\d+\.\d+\)$/, "")}`);
    });
  }
  return { main: encodeShiftJis(lines(main)), maps: encodeShiftJis(lines(maps)) };
}

/** 1 行ずつ CRLF を付ける。AdvanceMap と同じく、全角の空白は半角に、中黒（0xAF）は半角の「･」にする。 */
function lines(list: readonly string[]): string {
  return list.map((l) => `${l.replace(/　/g, " ").replace(/・/g, "･")}\r\n`).join("");
}
