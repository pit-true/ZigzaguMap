import { formatHex } from "../binary/bytes.js";
import { writeIndentedJson, type BochiJsonValue } from "../project/BochiJson.js";
import { ProjectFormatError } from "../project/ProjectFormatError.js";
import { asRecord, parseJsonObject, readArray, readInt, readString, type JsonRecord } from "../project/jsonRead.js";
import {
  FLY_DESTINATION_COUNT,
  HEAL_LOCATION_COUNT,
  MAPSEC_COUNT,
  MAPSEC_FIRST,
  REGION_MAP_HEIGHT,
  REGION_MAP_LAYERS,
  REGION_MAP_PAGES,
  REGION_MAP_WIDTH,
} from "./constants.js";
import { RegionMapDocument, layoutIndex, type HealLocation, type RegionMapSnapshot } from "./RegionMapDocument.js";

/** maps\regionmap.json の Format の値。 */
export const REGION_MAP_FORMAT = 1;

/** 表の名前（JSON のキー）。変えた表だけを書く。 */
const TABLES = ["Layouts", "Positions", "Sizes", "FlyDestinations", "HealLocations", "MapVisitFlags", "DungeonVisitFlags"] as const;

/**
 * maps\regionmap.json の読み書き。ベース ROM と違う表だけを、項目ごとの読める形で書く。
 *
 * - Layouts: 面（kanto / sevii123 / sevii45 / sevii67）とレイヤー（map / dungeon）ごとに、15 行の「16 進 2 桁を空白区切りで 22 個」。
 *   変えた面・レイヤーだけを書く。
 * - Positions / Sizes: 地名 0x58〜0xC5 の全件（Id は `0x58` の形）。
 * - FlyDestinations: 地名 0x58〜0xC3 の全件（Bank, Map, HealLocation）。
 * - HealLocations: 飛び先 1〜20 の全件（Index, Bank, Map, X, Y, Unknown）。イベントタブのフライトポジションと同じ表。
 *   Unknown は末尾の 2 バイト（AdvanceMap の「不明:」）。Unknown の無い古いファイルはベース ROM の値を使う。
 * - MapVisitFlags / DungeonVisitFlags: 地名 0x58〜0xC5 の全件（Flag は `0x0890` の形、無ければ null）。
 */
export class RegionMapJson {
  /** ベース ROM との差を書く。差が無ければ null。 */
  static stringify(doc: RegionMapDocument, base: RegionMapDocument): string | null {
    const a = doc.snapshot();
    const b = base.snapshot();
    const out: Record<string, BochiJsonValue> = { Format: REGION_MAP_FORMAT };
    const layouts: BochiJsonValue[] = [];
    REGION_MAP_PAGES.forEach((page, p) =>
      REGION_MAP_LAYERS.forEach((layer, l) => {
        const i = layoutIndex(p, l);
        if (same(a.layouts[i], b.layouts[i])) return;
        const rows: string[] = [];
        for (let y = 0; y < REGION_MAP_HEIGHT; y++) {
          rows.push(
            a.layouts[i]!.slice(y * REGION_MAP_WIDTH, (y + 1) * REGION_MAP_WIDTH)
              .map((v) => hex(v, 2))
              .join(" "),
          );
        }
        layouts.push({ Page: page, Layer: layer, Rows: rows });
      }),
    );
    if (layouts.length > 0) out["Layouts"] = layouts;
    if (!same(a.sections.map((s) => [s.x, s.y]), b.sections.map((s) => [s.x, s.y]))) {
      out["Positions"] = a.sections.map((s, i) => ({ Id: id(i), X: s.x, Y: s.y }));
    }
    if (!same(a.sections.map((s) => [s.width, s.height]), b.sections.map((s) => [s.width, s.height]))) {
      out["Sizes"] = a.sections.map((s, i) => ({ Id: id(i), Width: s.width, Height: s.height }));
    }
    if (!same(a.fly, b.fly)) out["FlyDestinations"] = a.fly.map((f, i) => ({ Id: id(i), Bank: f.bank, Map: f.map, HealLocation: f.heal }));
    if (!same(a.heal, b.heal)) out["HealLocations"] = a.heal.map((h, i) => ({ Index: i + 1, Bank: h.bank, Map: h.map, X: h.x, Y: h.y, Unknown: h.unknown }));
    if (!same(a.mapFlags, b.mapFlags)) out["MapVisitFlags"] = flagList(a.mapFlags);
    if (!same(a.dungeonFlags, b.dungeonFlags)) out["DungeonVisitFlags"] = flagList(a.dungeonFlags);
    if (Object.keys(out).length === 1) return null;
    return writeIndentedJson(out);
  }

  /**
   * 飛び先（HealLocations）だけを読む（タウンマップの絵を読まずに、イベントタブのフライトポジションへ重ねるため）。
   * `heal` はベース ROM の値で、書かれていればその値に置き換える。書かれていなければ false。
   */
  static applyHealLocations(text: string, heal: HealLocation[], path: string | null = null): boolean {
    const o = parseJsonObject(text, path);
    return readHealLocations(o, heal, path);
  }

  /** 読む。書かれていない表はベース ROM の値。形式が不正なら ProjectFormatError。 */
  static parse(text: string, base: RegionMapDocument, path: string | null = null): RegionMapDocument {
    const o = parseJsonObject(text, path);
    const format = readInt(o, "Format", path);
    if (format !== REGION_MAP_FORMAT) throw new ProjectFormatError(`対応していない Format です: ${format}`, path);
    for (const key of Object.keys(o)) {
      if (key !== "Format" && !(TABLES as readonly string[]).includes(key)) throw new ProjectFormatError(`知らない表です: ${key}`, path);
    }
    const s: RegionMapSnapshot = base.snapshot();

    for (const [n, raw] of readArray(o, "Layouts", path).entries()) {
      const e = asRecord(raw, `Layouts[${n}]`, path);
      const p = (REGION_MAP_PAGES as readonly string[]).indexOf(readString(e, "Page", path));
      const l = (REGION_MAP_LAYERS as readonly string[]).indexOf(readString(e, "Layer", path));
      if (p < 0 || l < 0) throw new ProjectFormatError(`Layouts[${n}] の Page / Layer が違います`, path);
      const rows = readArray(e, "Rows", path);
      if (rows.length !== REGION_MAP_HEIGHT) throw new ProjectFormatError(`Layouts[${n}].Rows は ${REGION_MAP_HEIGHT} 行でなければなりません`, path);
      const cells: number[] = [];
      for (const row of rows) {
        const parts = typeof row === "string" ? row.trim().split(/\s+/) : [];
        if (parts.length !== REGION_MAP_WIDTH || parts.some((v) => !/^[0-9A-Fa-f]{1,2}$/.test(v))) {
          throw new ProjectFormatError(`Layouts[${n}].Rows の行は 16 進 2 桁を ${REGION_MAP_WIDTH} 個並べてください`, path);
        }
        cells.push(...parts.map((v) => parseInt(v, 16)));
      }
      s.layouts[layoutIndex(p, l)] = cells;
    }

    const positions = entries(o, "Positions", MAPSEC_COUNT, path);
    positions?.forEach((e, i) => {
      checkId(e, i, "Positions", path);
      s.sections[i]!.x = int(e, "X", -0x8000, 0x7fff, path);
      s.sections[i]!.y = int(e, "Y", -0x8000, 0x7fff, path);
    });
    const sizes = entries(o, "Sizes", MAPSEC_COUNT, path);
    sizes?.forEach((e, i) => {
      checkId(e, i, "Sizes", path);
      s.sections[i]!.width = int(e, "Width", 0, 0xffff, path);
      s.sections[i]!.height = int(e, "Height", 0, 0xffff, path);
    });
    entries(o, "FlyDestinations", FLY_DESTINATION_COUNT, path)?.forEach((e, i) => {
      checkId(e, i, "FlyDestinations", path);
      s.fly[i] = { bank: int(e, "Bank", 0, 255, path), map: int(e, "Map", 0, 255, path), heal: int(e, "HealLocation", 0, 255, path) };
    });
    readHealLocations(o, s.heal, path);
    for (const [key, list] of [
      ["MapVisitFlags", s.mapFlags],
      ["DungeonVisitFlags", s.dungeonFlags],
    ] as const) {
      entries(o, key, MAPSEC_COUNT, path)?.forEach((e, i) => {
        checkId(e, i, key, path);
        const v = e["Flag"];
        if (v === null) list[i] = 0xffff;
        else if (typeof v === "string" && /^0x[0-9A-Fa-f]{1,4}$/.test(v)) list[i] = parseInt(v.slice(2), 16);
        else throw new ProjectFormatError(`${key} の Flag は "0x0890" の形か null でなければなりません`, path);
      });
    }
    return new RegionMapDocument(s);
  }
}

function hex(v: number, digits: number): string {
  return formatHex(v, digits);
}

function id(index: number): string {
  return "0x" + hex(MAPSEC_FIRST + index, 2);
}

function flagList(flags: number[]): BochiJsonValue[] {
  return flags.map((f, i) => ({ Id: id(i), Flag: f === 0xffff ? null : "0x" + hex(f, 4) }));
}

/** HealLocations を `heal`（ベース ROM の値）へ重ねる。書かれていなければ false。 */
function readHealLocations(o: JsonRecord, heal: HealLocation[], path: string | null): boolean {
  const list = entries(o, "HealLocations", HEAL_LOCATION_COUNT, path);
  list?.forEach((e, i) => {
    if (readInt(e, "Index", path) !== i + 1) throw new ProjectFormatError(`HealLocations の ${i + 1} 番目の Index が違います`, path);
    heal[i] = {
      bank: int(e, "Bank", 0, 255, path),
      map: int(e, "Map", 0, 255, path),
      x: int(e, "X", -0x8000, 0x7fff, path),
      y: int(e, "Y", -0x8000, 0x7fff, path),
      unknown: e["Unknown"] === undefined ? heal[i]!.unknown : int(e, "Unknown", 0, 0xffff, path),
    };
  });
  return list !== null;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function entries(o: JsonRecord, key: string, count: number, path: string | null): JsonRecord[] | null {
  if (o[key] === undefined) return null;
  const list = readArray(o, key, path);
  if (list.length !== count) throw new ProjectFormatError(`${key} は ${count} 件でなければなりません`, path);
  return list.map((v, i) => asRecord(v, `${key}[${i}]`, path));
}

function checkId(e: JsonRecord, index: number, key: string, path: string | null): void {
  if (readString(e, "Id", path).toUpperCase() !== id(index).toUpperCase()) {
    throw new ProjectFormatError(`${key} の ${index + 1} 番目の Id は ${id(index)} でなければなりません`, path);
  }
}

function int(e: JsonRecord, key: string, min: number, max: number, path: string | null): number {
  const v = readInt(e, key, path);
  if (v < min || v > max) throw new ProjectFormatError(`${key} は ${min}〜${max} でなければなりません`, path);
  return v;
}
