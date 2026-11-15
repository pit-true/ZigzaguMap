import { readTextIfExists, type ProjectFs } from "../../project/ProjectFs.js";
import { parseJsonObject, type JsonRecord } from "../../project/jsonRead.js";
import { REGION_MAP_HEIGHT, REGION_MAP_PAGES, REGION_MAP_WIDTH } from "../../regionmap/constants.js";
import { SCRIPT_CONFIG_FILE } from "./ScriptConfigJson.js";

/** 設定ファイルの中の、タウンマップの小窓の紐づけの節の名前（#386）。 */
export const TOWN_MAP_CONFIG_SECTION = "townMap";

/** 紐づけた範囲（タウンマップの面とマス）。 */
export interface TownLinkRect {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * ユーザーが小窓で決めたタウンマップの位置（#386）。ZigzaguMap の画面でだけ使い、ROM・`maps\regionmap.json`・
 * ワールドマップエディタの中身には入れない。
 * - `sections`: 地名の番号 → 範囲（その地名のマップ全部に使う）。
 * - `maps`: `"バンク.マップ"`（例 `"3.0"`）→ 範囲（そのマップだけ。地名の紐づけより先に使う）。
 */
export interface TownLinks {
  readonly sections: ReadonlyMap<number, TownLinkRect>;
  readonly maps: ReadonlyMap<string, TownLinkRect>;
}

/** 紐づけが無い。 */
export const EMPTY_TOWN_LINKS: TownLinks = { sections: new Map(), maps: new Map() };

/** マップの鍵（`"3.0"`）。 */
export function townMapKey(bank: number, map: number): string {
  return `${bank}.${map}`;
}

/** 範囲として正しいか（面 0〜3、マスが表の中、大きさ 1 以上）。 */
export function isTownLinkRect(r: TownLinkRect): boolean {
  const ints = [r.page, r.x, r.y, r.width, r.height].every((v) => Number.isInteger(v));
  return (
    ints &&
    r.page >= 0 &&
    r.page < REGION_MAP_PAGES.length &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width >= 1 &&
    r.height >= 1 &&
    r.x + r.width <= REGION_MAP_WIDTH &&
    r.y + r.height <= REGION_MAP_HEIGHT
  );
}

/**
 * 紐づけの節（`zigzagumap.json` の `"townMap"`、または個人設定の ROM ごとの値）を読む。形式はここだけで扱う。
 *
 * ```json
 * { "townMap": { "sections": { "0x58": { "page": 0, "x": 4, "y": 11, "width": 1, "height": 1 } },
 *                "maps": { "3.0": { "page": 0, "x": 4, "y": 11, "width": 1, "height": 1 } } } }
 * ```
 * 地名の鍵は `"0x58"`（16 進）か `"88"`（10 進）、マップの鍵は `"バンク.マップ"`。壊れた項目（鍵が読めない・範囲が表の外・
 * 数でない）は読み飛ばす（画面を止めない）。書き戻すときも、読み飛ばした項目はそのまま残す（`stringifyTownMapConfig`）。
 */
export function readTownLinks(value: unknown): TownLinks {
  const o = record(value);
  if (!o) return EMPTY_TOWN_LINKS;
  const sections = new Map<number, TownLinkRect>();
  for (const [k, v] of Object.entries(record(o.sections) ?? {})) {
    const id = parseSectionKey(k);
    const r = readRect(v);
    if (id !== null && r) sections.set(id, r);
  }
  const maps = new Map<string, TownLinkRect>();
  for (const [k, v] of Object.entries(record(o.maps) ?? {})) {
    const key = parseMapKey(k);
    const r = readRect(v);
    if (key !== null && r) maps.set(key, r);
  }
  return { sections, maps };
}

/**
 * 紐づけを節の形（JSON の値）にする。`previous` は前の節の値（無ければ null）で、知らない項目と読み飛ばした壊れた項目は残す
 * （同じ地名・マップをいま紐づけていれば、そちらで置き換える）。読めた項目で `links` に無いものは消す（外した紐づけ）。
 */
export function writeTownLinks(links: TownLinks, previous: unknown = null): JsonRecord {
  const old = record(previous) ?? {};
  const out: JsonRecord = { ...old };
  const sections: JsonRecord = {};
  for (const [k, v] of Object.entries(record(old.sections) ?? {})) {
    const id = parseSectionKey(k);
    if (id === null || (!readRect(v) && !links.sections.has(id))) sections[k] = v;
  }
  for (const [id, r] of [...links.sections].sort((a, b) => a[0] - b[0])) sections[sectionKey(id)] = rectJson(r);
  const maps: JsonRecord = {};
  for (const [k, v] of Object.entries(record(old.maps) ?? {})) {
    const key = parseMapKey(k);
    if (key === null || (!readRect(v) && !links.maps.has(key))) maps[k] = v;
  }
  for (const [key, r] of [...links.maps].sort((a, b) => compareMapKey(a[0], b[0]))) maps[key] = rectJson(r);
  out.sections = sections;
  out.maps = maps;
  return out;
}

/** `zigzagumap.json` の文字列から紐づけを読む（ファイルや節が無ければ空。JSON として読めなければ ProjectFormatError）。 */
export function parseTownMapConfig(text: string | null, path: string | null = SCRIPT_CONFIG_FILE): TownLinks {
  if (text === null || text.trim() === "") return EMPTY_TOWN_LINKS;
  return readTownLinks(parseJsonObject(text, path)[TOWN_MAP_CONFIG_SECTION]);
}

/**
 * `zigzagumap.json` に紐づけを書いた文字列。`previous` は今のファイルの文字列（無ければ null）。ほかの節と知らない項目は残し、
 * `"townMap"` の節だけを置き換える。字下げ 2、LF で終わる。今のファイルが JSON として読めなければ ProjectFormatError（壊さない）。
 */
export function stringifyTownMapConfig(links: TownLinks, previous: string | null, path: string | null = SCRIPT_CONFIG_FILE): string {
  const root: JsonRecord = previous === null || previous.trim() === "" ? {} : { ...parseJsonObject(previous, path) };
  root[TOWN_MAP_CONFIG_SECTION] = writeTownLinks(links, root[TOWN_MAP_CONFIG_SECTION]);
  return JSON.stringify(root, null, 2) + "\n";
}

/** プロジェクトの紐づけを読む（ファイルが無ければ空）。 */
export async function loadTownMapConfig(fs: ProjectFs): Promise<TownLinks> {
  return parseTownMapConfig(await readTextIfExists(fs, SCRIPT_CONFIG_FILE));
}

/** プロジェクトの `zigzagumap.json` に紐づけを書く（書く直前に今のファイルを読み直し、ほかの節は残す）。 */
export async function saveTownMapConfig(fs: ProjectFs, links: TownLinks): Promise<void> {
  const text = await readTextIfExists(fs, SCRIPT_CONFIG_FILE);
  await fs.writeText(SCRIPT_CONFIG_FILE, stringifyTownMapConfig(links, text));
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function readRect(value: unknown): TownLinkRect | null {
  const o = record(value);
  if (!o) return null;
  const n = (k: string, fallback?: number): number => {
    const v = o[k];
    return v === undefined && fallback !== undefined ? fallback : typeof v === "number" ? v : NaN;
  };
  const r = { page: n("page", 0), x: n("x"), y: n("y"), width: n("width", 1), height: n("height", 1) };
  return isTownLinkRect(r) ? r : null;
}

function rectJson(r: TownLinkRect): JsonRecord {
  return { page: r.page, x: r.x, y: r.y, width: r.width, height: r.height };
}

function parseSectionKey(key: string): number | null {
  const t = key.trim();
  const n = /^0x[0-9a-f]{1,2}$/i.test(t) ? parseInt(t.slice(2), 16) : /^[0-9]{1,3}$/.test(t) ? parseInt(t, 10) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 0xff ? n : null;
}

function sectionKey(id: number): string {
  return "0x" + id.toString(16).toUpperCase().padStart(2, "0");
}

function parseMapKey(key: string): string | null {
  const m = /^\s*([0-9]{1,3})\.([0-9]{1,3})\s*$/.exec(key);
  if (!m) return null;
  const bank = Number(m[1]);
  const map = Number(m[2]);
  return bank <= 0xff && map <= 0xff ? townMapKey(bank, map) : null;
}

function compareMapKey(a: string, b: string): number {
  const [ab, am] = a.split(".").map(Number) as [number, number];
  const [bb, bm] = b.split(".").map(Number) as [number, number];
  return ab - bb || am - bm;
}
