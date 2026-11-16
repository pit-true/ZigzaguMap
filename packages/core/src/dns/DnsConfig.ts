import type { ProjectFs } from "../project/ProjectFs.js";
import { evaluateCExpression, preprocessC, readCArray, readCEnum, type CInit, type CInitList, type CSource } from "./cTable.js";

/**
 * CFRU の昼夜の色変え（DNS）の設定を、プロジェクトのソースから読む（Phase6 #432）。
 *
 * 読むファイル（プロジェクトフォルダ = CFRU のフォルダからの相対）
 * - `src/config.h`: `TIME_ENABLED` の有無と `TIME_*_START`
 * - `include/new/dns_data.h`: 色の表 `gDNSNightFadingByTime[24][6]`、対象のパレット `OW_BG_PAL_n`・`OW_SPRITE_PAL_n`、
 *   光るタイル `gSpecificTilesetFades`
 * - `include/new/dns.h`（無くてよい）: `DNS_COEFF_HALVE_CHANNELS`（Chronos の朝の「青を半分」の計算）
 * - `src/chronos_time.c`・`include/new/chronos_time.h`（無くてよい。Chronos）: 区分ごとの時刻 `sTimeOfDayHours`
 *
 * 区分はどちらのプロジェクトも朝・昼・夕・夜の 4 つ（ユーザーの返事。Chronos の深夜は夜と同じに扱い、区分を出さない）。
 */

/** 時間帯の区分。並びは実機の時刻の順（朝・昼・夕・夜）。 */
export type TimeOfDay = "morning" | "day" | "evening" | "night";

/** 区分の並び（朝・昼・夕・夜）。 */
export const TIMES_OF_DAY: readonly TimeOfDay[] = ["morning", "day", "evening", "night"];

/**
 * ND（実機の時計で動く）の区分ごとの代表の時刻。Chronos の `sTimeOfDayHours` と同じ時刻にした
 * （朝 6:00・昼 12:00・夕 18:00・夜 21:00）。区分の範囲（`TIME_*_START`）の外になるときは、区分の始まりの時刻を使う。
 */
export const DEFAULT_TIME_HOURS: Readonly<Record<TimeOfDay, number>> = { morning: 6, day: 12, evening: 18, night: 21 };

/** 表の 1 件（混ぜる色と係数）。 */
export interface DnsFade {
  /** 混ぜる色（BGR555）。 */
  readonly color: number;
  /** 係数（0〜16。`DNS_COEFF_HALVE_CHANNELS` の値なら半分の計算）。 */
  readonly amount: number;
}

/** 光るタイル（夜だけ、決まった色に置き換える）。 */
export interface DnsLitTile {
  /** タイルセットのヘッダーの位置（`0x08……`）。 */
  readonly tilesetPointer: number;
  /** パレットの番号（0〜15）。 */
  readonly palette: number;
  /** 色番号と置き換える色（BGR555）。 */
  readonly colors: readonly { readonly index: number; readonly color: number }[];
}

/** 区分 1 つ（名前と代表の時刻）。 */
export interface DnsTimeSection {
  readonly id: TimeOfDay;
  readonly hour: number;
  readonly minute: number;
}

/** 読んだ設定。 */
export interface DnsConfig {
  /** 区分（朝・昼・夕・夜の 4 つ）。 */
  readonly sections: readonly DnsTimeSection[];
  /** 時刻の元。Chronos はセーブの 1 バイト、ND は実機の時計。 */
  readonly clock: "chronos" | "rtc";
  /**
   * Chronos の `settimeofday` の値（0〜）の区分。深夜（`TIME_MIDNIGHT`）は夜にする。ND では空。
   * スクリプトの再生（P6-A）が `settimeofday` を `view.timeOfDay` に直すときに使う。
   */
  readonly chronosValues: readonly TimeOfDay[];
  /** 区分の始まりの時（`TIME_MORNING_START` など）。 */
  readonly starts: Readonly<Record<TimeOfDay, number>>;
  /** 時刻ごとの表（24 時 × 6 件 = 144 件。`hour * 6 + minute / 10`）。書かれていない所は色 0・係数 0。 */
  readonly fades: readonly DnsFade[];
  /** 色を変える背景のパレット（ビット n がパレット n）。 */
  readonly bgPalettes: number;
  /** 色を変える OBJ のパレット（ビット n がパレット n）。 */
  readonly spritePalettes: number;
  /** 半分の計算を表す係数の値（`DNS_COEFF_HALVE_CHANNELS`）。無ければ null。 */
  readonly halveCoefficient: number | null;
  /** 光るタイル（`#ifndef UNBOUND` の側）。 */
  readonly litTiles: readonly DnsLitTile[];
}

/** 読めなかった理由。 */
export interface DnsConfigError {
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

/** 読むファイルの中身（無いものは null）。 */
export interface DnsSourceFiles {
  readonly configH: string | null;
  readonly dnsDataH: string | null;
  readonly dnsH?: string | null;
  readonly chronosTimeC?: string | null;
  readonly chronosTimeH?: string | null;
}

export const DNS_FILES = {
  configH: "src/config.h",
  dnsDataH: "include/new/dns_data.h",
  dnsH: "include/new/dns.h",
  chronosTimeC: "src/chronos_time.c",
  chronosTimeH: "include/new/chronos_time.h",
} as const;

/** CFRU の既定の対象（背景 0〜12、OBJ 全部）。`OW_BG_PAL_n` が書かれていないときに使う。 */
const DEFAULT_BG_PALETTES = 0x1fff;
const DEFAULT_SPRITE_PALETTES = 0xffff;

export type DnsConfigResult = { readonly config: DnsConfig } | { readonly error: DnsConfigError };

/** プロジェクトフォルダから読む。 */
export async function readDnsConfig(fs: ProjectFs): Promise<DnsConfigResult> {
  const read = async (path: string): Promise<string | null> => {
    try {
      return (await fs.exists(path)) ? await fs.readText(path) : null;
    } catch {
      return null;
    }
  };
  return parseDnsConfig({
    configH: await read(DNS_FILES.configH),
    dnsDataH: await read(DNS_FILES.dnsDataH),
    dnsH: await read(DNS_FILES.dnsH),
    chronosTimeC: await read(DNS_FILES.chronosTimeC),
    chronosTimeH: await read(DNS_FILES.chronosTimeH),
  });
}

/** 読んだファイルの中身から設定を作る。 */
export function parseDnsConfig(files: DnsSourceFiles): DnsConfigResult {
  const fail = (file: string, message: string, line?: number): DnsConfigResult => ({ error: { file, message, ...(line !== undefined ? { line } : {}) } });
  if (files.configH === null) return fail(DNS_FILES.configH, "ファイルが無い");
  if (files.dnsDataH === null) return fail(DNS_FILES.dnsDataH, "ファイルが無い");

  const config = preprocessC(files.configH);
  if (!config.defines.has("TIME_ENABLED")) return fail(DNS_FILES.configH, "TIME_ENABLED が定義されていない（時間帯の機能が無い）");
  const known = new Map(config.defines);
  const dnsH = files.dnsH ? preprocessC(files.dnsH, known) : null;
  for (const [k, v] of dnsH?.defines ?? []) if (!known.has(k)) known.set(k, v);
  const data = preprocessC(files.dnsDataH, known);
  for (const [k, v] of data.defines) if (!known.has(k)) known.set(k, v);
  const resolve = resolver(known);

  // 区分の始まり
  const starts = {} as Record<TimeOfDay, number>;
  for (const [id, name] of [
    ["morning", "TIME_MORNING_START"],
    ["day", "TIME_DAY_START"],
    ["evening", "TIME_EVENING_START"],
    ["night", "TIME_NIGHT_START"],
  ] as const) {
    const v = resolve(name);
    if (v === null || v > 23) return fail(DNS_FILES.configH, `${name} が読めない`);
    starts[id] = v;
  }

  // 色の表
  const table = readCArray(data, "gDNSNightFadingByTime");
  if (table === null) return fail(DNS_FILES.dnsDataH, "gDNSNightFadingByTime が無い");
  if ("error" in table) return fail(DNS_FILES.dnsDataH, `gDNSNightFadingByTime が読めない（${table.error}）`, table.line);
  const fades = readFades(table.init, resolve);
  if ("error" in fades) return fail(DNS_FILES.dnsDataH, `gDNSNightFadingByTime が読めない（${fades.error}）`, fades.line);

  // 対象のパレット
  const mask = (prefix: string, fallback: number): number => {
    let out = 0;
    let found = false;
    for (let n = 0; n < 16; n++) {
      const v = resolve(`${prefix}${n}`);
      if (v === null) continue;
      found = true;
      if (v !== 0) out |= 1 << n;
    }
    return found ? out : fallback;
  };

  // 光るタイル
  const litTiles: DnsLitTile[] = [];
  const lit = readCArray(data, "gSpecificTilesetFades");
  if (lit !== null) {
    if ("error" in lit) return fail(DNS_FILES.dnsDataH, `gSpecificTilesetFades が読めない（${lit.error}）`, lit.line);
    const r = readLitTiles(lit.init, resolve);
    if ("error" in r) return fail(DNS_FILES.dnsDataH, `gSpecificTilesetFades が読めない（${r.error}）`, r.line);
    litTiles.push(...r.tiles);
  }

  // 区分の代表の時刻（Chronos は sTimeOfDayHours、ND は既定の時刻）
  const chronos = readChronosHours(files, known);
  if (chronos && "error" in chronos) return fail(chronos.file, chronos.error, chronos.line);
  const sections = TIMES_OF_DAY.map((id): DnsTimeSection => {
    const hour = chronos?.hours.get(id) ?? (inSection(DEFAULT_TIME_HOURS[id], id, starts) ? DEFAULT_TIME_HOURS[id] : starts[id]);
    return { id, hour, minute: 0 };
  });

  return {
    config: {
      sections,
      clock: chronos ? "chronos" : "rtc",
      chronosValues: chronos?.values ?? [],
      starts,
      fades: fades.fades,
      bgPalettes: mask("OW_BG_PAL_", DEFAULT_BG_PALETTES),
      spritePalettes: mask("OW_SPRITE_PAL_", DEFAULT_SPRITE_PALETTES),
      halveCoefficient: resolve("DNS_COEFF_HALVE_CHANNELS"),
      litTiles,
    },
  };
}

/** 時刻 `hour` がその区分に入るか（CFRU の `IsMorning` などと同じ判定）。 */
export function timeOfDayAt(hour: number, starts: Readonly<Record<TimeOfDay, number>>): TimeOfDay {
  if (hour >= starts.night || hour < starts.morning) return "night";
  if (hour >= starts.evening) return "evening";
  if (hour >= starts.day) return "day";
  return "morning";
}

function inSection(hour: number, id: TimeOfDay, starts: Readonly<Record<TimeOfDay, number>>): boolean {
  return timeOfDayAt(hour, starts) === id;
}

/** `#define` の名前を数に直す関数（循環は null）。 */
function resolver(defines: ReadonlyMap<string, string>): (name: string) => number | null {
  const cache = new Map<string, number | null>();
  const resolve = (name: string): number | null => {
    if (cache.has(name)) return cache.get(name)!;
    const text = defines.get(name);
    if (text === undefined) return null;
    cache.set(name, null);
    const v = text === "" ? null : evaluateCExpression(text, resolve);
    cache.set(name, v);
    return v;
  };
  return resolve;
}

type Fail = { error: string; line: number };

function readFades(init: CInitList, resolve: (name: string) => number | null): { fades: DnsFade[] } | Fail {
  const fades: DnsFade[] = Array.from({ length: 24 * 6 }, () => ({ color: 0, amount: 0 }));
  let hour = 0;
  for (const row of init.items) {
    if (row.index !== undefined) {
      const h = evaluateCExpression(row.index, resolve);
      if (h === null) return { error: `時の番号「${row.index}」`, line: row.line };
      hour = h;
    }
    if (hour < 0 || hour > 23) return { error: `時の番号 ${hour}`, line: row.line };
    if (typeof row.value === "string") return { error: "時の行が「{ … }」でない", line: row.line };
    let slot = 0;
    for (const item of row.value.items) {
      if (item.index !== undefined) {
        const s = evaluateCExpression(item.index, resolve);
        if (s === null) return { error: `10 分の番号「${item.index}」`, line: item.line };
        slot = s;
      }
      if (slot < 0 || slot > 5) return { error: `10 分の番号 ${slot}`, line: item.line };
      const f = readStruct(item.value, ["colour", "amount"], resolve);
      if (!f) return { error: "「{色, 係数}」が読めない", line: item.line };
      fades[hour * 6 + slot] = { color: f["colour"]! & 0xffff, amount: f["amount"]! & 0xff };
      slot++;
    }
    hour++;
  }
  return { fades };
}

/** 構造体の初期化子（並びの順か `.名前 =`）を、名前 → 数にする。読めなければ null。 */
function readStruct(value: CInit, fields: readonly string[], resolve: (name: string) => number | null): Record<string, number> | null {
  if (typeof value === "string") return null;
  const out: Record<string, number> = {};
  let k = 0;
  for (const item of value.items) {
    const name = item.field ?? fields[k];
    if (name === undefined || typeof item.value !== "string") return null;
    const v = evaluateCExpression(item.value, resolve);
    if (v === null) return null;
    out[name] = v;
    k = fields.indexOf(name) + 1;
  }
  return fields.every((f) => f in out) ? out : null;
}

function readLitTiles(init: CInitList, resolve: (name: string) => number | null): { tiles: DnsLitTile[] } | Fail {
  const tiles: DnsLitTile[] = [];
  for (const entry of init.items) {
    if (typeof entry.value === "string") return { error: "1 件が「{ … }」でない", line: entry.line };
    let pointer: number | null = null;
    let palette: number | null = null;
    let indices: CInit | null = null;
    const order = ["tilesetPointer", "paletteNumToFade", "paletteIndicesToFade"];
    let k = 0;
    for (const item of entry.value.items) {
      const name = item.field ?? order[k];
      k = order.indexOf(name ?? "") + 1;
      if (name === "paletteIndicesToFade") indices = item.value;
      else if (typeof item.value === "string") {
        const v = evaluateCExpression(item.value, resolve);
        if (v === null) return { error: `「${item.value}」が読めない`, line: item.line };
        if (name === "tilesetPointer") pointer = v;
        else if (name === "paletteNumToFade") palette = v;
      }
    }
    if (pointer === null || palette === null || palette > 15 || indices === null || typeof indices === "string") {
      return { error: "tilesetPointer・paletteNumToFade・paletteIndicesToFade が揃っていない", line: entry.line };
    }
    const colors: { index: number; color: number }[] = [];
    for (const c of indices.items) {
      const s = readStruct(c.value, ["index", "colour"], resolve);
      if (!s) return { error: "「{色番号, 色}」が読めない", line: c.line };
      if (s["index"] === 0xff) break; // TILESET_PAL_FADE_END
      if (s["index"]! > 15) return { error: `色番号 ${s["index"]}`, line: c.line };
      colors.push({ index: s["index"]!, color: s["colour"]! & 0xffff });
    }
    tiles.push({ tilesetPointer: pointer >>> 0, palette, colors });
  }
  return { tiles };
}

/** Chronos の区分の時刻。ファイルが無ければ null。 */
function readChronosHours(
  files: DnsSourceFiles,
  known: ReadonlyMap<string, string>,
): { hours: Map<TimeOfDay, number>; values: TimeOfDay[] } | { file: string; error: string; line?: number } | null {
  if (!files.chronosTimeC || !files.chronosTimeH) return null;
  const header = preprocessC(files.chronosTimeH, known);
  const enumValues = readCEnum(header, "ChronosTimeOfDay");
  if (!enumValues) return { file: DNS_FILES.chronosTimeH, error: "enum ChronosTimeOfDay が読めない" };
  const source: CSource = preprocessC(files.chronosTimeC, known);
  const table = readCArray(source, "sTimeOfDayHours");
  if (table === null) return { file: DNS_FILES.chronosTimeC, error: "sTimeOfDayHours が無い" };
  if ("error" in table) return { file: DNS_FILES.chronosTimeC, error: `sTimeOfDayHours が読めない（${table.error}）`, line: table.line };
  const resolve = (name: string) => enumValues.get(name) ?? null;
  const byValue = new Map<number, number>();
  let k = 0;
  for (const item of table.init.items) {
    if (item.index !== undefined) {
      const v = evaluateCExpression(item.index, resolve);
      if (v === null) return { file: DNS_FILES.chronosTimeC, error: `「${item.index}」が読めない`, line: item.line };
      k = v;
    }
    const hour = typeof item.value === "string" ? evaluateCExpression(item.value, resolve) : null;
    if (hour === null || hour > 23) return { file: DNS_FILES.chronosTimeC, error: "時刻が読めない", line: item.line };
    byValue.set(k++, hour);
  }
  const hours = new Map<TimeOfDay, number>();
  const values: TimeOfDay[] = [];
  for (const [name, value] of [...enumValues].sort((a, b) => a[1] - b[1])) {
    const id = chronosName(name);
    if (!id) continue;
    // 深夜（TIME_MIDNIGHT）は夜と同じに扱う（区分を出さない。ユーザーの返事）
    values[value] = id;
    if (!name.includes("MIDNIGHT") && byValue.has(value)) hours.set(id, byValue.get(value)!);
  }
  for (let i = 0; i < values.length; i++) values[i] ??= "day";
  return { hours, values };
}

function chronosName(name: string): TimeOfDay | null {
  if (name.startsWith("NUM_")) return null;
  if (name.includes("MIDNIGHT")) return "night";
  if (name.includes("MORNING")) return "morning";
  if (name.includes("EVENING")) return "evening";
  if (name.includes("NIGHT")) return "night";
  if (name.includes("DAY")) return "day";
  return null;
}

/** 時刻の表の 1 件（`minute` は 10 分ごとに切り捨てる）。 */
export function fadeAt(config: Pick<DnsConfig, "fades">, hour: number, minute: number): DnsFade {
  return config.fades[(((hour % 24) + 24) % 24) * 6 + Math.min(5, Math.floor(minute / 10))] ?? { color: 0, amount: 0 };
}
