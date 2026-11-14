import { type BochiJsonValue, writeIndentedJson } from "../../project/BochiJson.js";
import { ProjectFormatError } from "../../project/ProjectFormatError.js";
import { mapLabelsFilePath } from "../../project/paths.js";
import { type JsonRecord, asRecord, parseJsonObject, readArray, readInt } from "../../project/jsonRead.js";
import { isMapScriptTableType, type MapScriptItem, type MapScriptTableModel } from "../edit/MapScriptTableText.js";
import { parseEventScriptKind, type EventScriptKind } from "../project/eventScriptKinds.js";

/** ラベルのファイルの Format の値。 */
export const MAP_LABELS_FORMAT = 1;

/**
 * マップ 1 枚のラベルのファイルのパス（`maps/BB/scripts_MM.json`）。
 * `MM.scripts.json` にしないのは、CFRU の `scripts/map_project.py` が `maps/[0-9]*\/[0-9]*.json` をマップの JSON として
 * 読むため（数字で始まる名前だとビルドが止まる）。
 */
export function mapLabelsPath(bank: number, map: number): string {
  return mapLabelsFilePath(bank, map);
}

/** `maps/BB/scripts_MM.json` のパスならバンクとマップ。違えば null。 */
export function parseMapLabelsPath(path: string): { bank: number; map: number } | null {
  const m = /^maps\/([0-9]+)\/scripts_([0-9]+)\.json$/i.exec(path);
  return m ? { bank: Number(m[1]), map: Number(m[2]) } : null;
}

/** イベント 1 つのラベル（照合用の座標つき）。 */
export interface MapLabelEntry {
  /** イベントの並びの中の番号（0 から）。 */
  readonly index: number;
  /** 書いたときのイベントの座標（Bochi などで順が変わったことを見つけるのに使う）。 */
  readonly x: number;
  readonly y: number;
  /** eventscripts の種別（人は `npc` / `trainer` / `item`、看板は `sign`、スクリプトタイルは `tile`）。 */
  readonly kind: EventScriptKind;
  readonly label: string;
}

/** ラベルのファイルの中身。 */
export interface MapLabelsFile {
  readonly bank: number;
  readonly map: number;
  /** マップスクリプトの表のラベル（eventscripts の `map` の行）。無ければ null。 */
  readonly mapScripts: string | null;
  /** ZigzaguMap が `.s` に書く表（`mapScripts` と同じラベル）。手で書いた表を指すだけなら null。 */
  readonly table: MapScriptTableModel | null;
  readonly persons: readonly MapLabelEntry[];
  readonly signs: readonly MapLabelEntry[];
  readonly traps: readonly MapLabelEntry[];
}

/**
 * `maps/BB/scripts_MM.json` の読み書き。Bochi と同じ整形（2 空白の字下げ、CRLF、ASCII 以外は \uXXXX）で書く。
 * ```json
 * { "Format": 1, "Bank": 3, "Map": 0, "MapScripts": "Moegi_MapScripts",
 *   "Table": { "Label": "Moegi_MapScripts", "Items": [{ "Type": 3, "Script": "Moegi_OnTransition" },
 *     { "Type": 2, "Conditions": [{ "Var": 16464, "Value": 0, "Script": "Moegi_Frame0" }] }] },
 *   "Persons": [{ "Index": 0, "X": 5, "Y": 3, "Kind": "npc", "Label": "Moegi_Npc0" }], "Signs": [], "Traps": [] }
 * ```
 */
export class MapLabelsJson {
  static parse(text: string, path: string | null = null): MapLabelsFile {
    const o = parseJsonObject(text, path);
    const format = readInt(o, "Format", path, MAP_LABELS_FORMAT);
    if (format !== MAP_LABELS_FORMAT) throw new ProjectFormatError(`対応していない Format です: ${format}`, path);
    const list = (key: string, kinds: readonly EventScriptKind[]): MapLabelEntry[] =>
      o[key] === undefined ? [] : readArray(o, key, path).map((v, i) => parseEntry(asRecord(v, `${key}[${i}]`, path), `${key}[${i}]`, kinds, path));
    const mapScripts = o["MapScripts"];
    if (mapScripts !== undefined && mapScripts !== null && typeof mapScripts !== "string") {
      throw new ProjectFormatError("MapScripts は文字列か null でなければなりません", path);
    }
    const table = o["Table"] === undefined || o["Table"] === null ? null : parseTable(asRecord(o["Table"], "Table", path), path);
    return {
      bank: readInt(o, "Bank", path),
      map: readInt(o, "Map", path),
      mapScripts: table ? table.label : ((mapScripts as string | null | undefined) ?? null),
      table,
      persons: list("Persons", ["npc", "trainer", "item"]),
      signs: list("Signs", ["sign"]),
      traps: list("Traps", ["tile"]),
    };
  }

  static stringify(file: MapLabelsFile): string {
    const entry = (e: MapLabelEntry): BochiJsonValue => ({ Index: e.index, X: e.x, Y: e.y, Kind: e.kind, Label: e.label });
    const root: Record<string, BochiJsonValue> = { Format: MAP_LABELS_FORMAT, Bank: file.bank, Map: file.map, MapScripts: file.mapScripts };
    if (file.table) {
      root["Table"] = {
        Label: file.table.label,
        Items: file.table.items.map((item): BochiJsonValue =>
          isMapScriptTableType(item.type)
            ? { Type: item.type, Conditions: item.conditions.map((c) => ({ Var: c.variable, Value: c.value, Script: c.script })) }
            : { Type: item.type, Script: item.script },
        ),
      };
    }
    root["Persons"] = file.persons.map(entry);
    root["Signs"] = file.signs.map(entry);
    root["Traps"] = file.traps.map(entry);
    return writeIndentedJson(root);
  }
}

function parseEntry(o: JsonRecord, at: string, kinds: readonly EventScriptKind[], path: string | null): MapLabelEntry {
  const label = o["Label"];
  if (typeof label !== "string" || label === "") throw new ProjectFormatError(`${at}.Label が必要です`, path);
  const kindText = o["Kind"];
  const kind = typeof kindText === "string" ? parseEventScriptKind(kindText) : kinds[0]!;
  if (!kind || !kinds.includes(kind)) throw new ProjectFormatError(`${at}.Kind が不正です: ${String(kindText)}`, path);
  return { index: readInt(o, "Index", path), x: readInt(o, "X", path, 0), y: readInt(o, "Y", path, 0), kind, label };
}

function parseTable(o: JsonRecord, path: string | null): MapScriptTableModel {
  const label = o["Label"];
  if (typeof label !== "string" || label === "") throw new ProjectFormatError("Table.Label が必要です", path);
  const items = readArray(o, "Items", path).map((v, i): MapScriptItem => {
    const item = asRecord(v, `Table.Items[${i}]`, path);
    const type = readInt(item, "Type", path);
    if (type < 1 || type > 7) throw new ProjectFormatError(`Table.Items[${i}].Type は 1〜7 でなければなりません`, path);
    if (isMapScriptTableType(type)) {
      const conditions = item["Conditions"] === undefined ? [] : readArray(item, "Conditions", path);
      return {
        type,
        script: "",
        conditions: conditions.map((c, j) => {
          const r = asRecord(c, `Table.Items[${i}].Conditions[${j}]`, path);
          return { variable: readInt(r, "Var", path), value: readInt(r, "Value", path), script: String(r["Script"] ?? "") };
        }),
      };
    }
    return { type, script: String(item["Script"] ?? ""), conditions: [] };
  });
  return { label, items };
}
