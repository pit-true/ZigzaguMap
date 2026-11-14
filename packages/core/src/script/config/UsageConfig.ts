import { ProjectFormatError } from "../../project/ProjectFormatError.js";
import { readTextIfExists, type ProjectFs } from "../../project/ProjectFs.js";
import { asRecord, parseJsonObject, type JsonRecord } from "../../project/jsonRead.js";
import { SCRIPT_CONFIG_FILE } from "./ScriptConfigJson.js";

/** 設定ファイルの中の、未使用の番号を探す範囲の節の名前（#227）。 */
export const USAGE_CONFIG_SECTION = "usage";

/** 索引で数える番号の種類。 */
export const USAGE_KINDS = ["flag", "var", "hiddenItem", "trainer"] as const;
/** 索引で数える番号の種類（フラグ・変数・隠しアイテムの番号・トレーナーの番号）。 */
export type UsageKind = (typeof USAGE_KINDS)[number];

/** 探す範囲 1 つ（両端を含む）と、範囲の中で使わない番号。 */
export interface UsageRange {
  readonly from: number;
  readonly to: number;
  /** 使わない番号の区間（両端を含む）。 */
  readonly exclude: readonly (readonly [number, number])[];
}

/** 種類ごとの探す範囲。 */
export type UsageConfig = Readonly<Record<UsageKind, UsageRange>>;

/**
 * 既定の範囲。
 * - フラグは 0x21 から（HMA と同じ起点）。隠しアイテムのフラグ（0x3E8〜）の前の 0x3E7 まで。
 * - 変数は 0x4034 から（HMA と同じ起点）、保存される変数の終わりの 0x40FF まで。
 * - 隠しアイテムの番号は 1〜255（看板の 1 バイト。フラグは 0x3E8 + 番号）。
 * - トレーナーは 1〜742（素の FR の表の 743 件。0 は「無し」）。表を広げる 743〜767 は #245 で扱う。
 */
export const DEFAULT_USAGE_CONFIG: UsageConfig = {
  flag: { from: 0x21, to: 0x3e7, exclude: [] },
  var: { from: 0x4034, to: 0x40ff, exclude: [] },
  hiddenItem: { from: 1, to: 0xff, exclude: [] },
  trainer: { from: 1, to: 742, exclude: [] },
};

/** 節の中の種類の名前（JSON の項目名）。 */
const KEY_OF: Readonly<Record<UsageKind, string>> = { flag: "flags", var: "vars", hiddenItem: "hiddenItems", trainer: "trainers" };

/**
 * `zigzagumap.json` の `"usage"` の節を読む。形式はここだけで扱う。
 *
 * ```json
 * { "usage": { "flags": { "from": "0x21", "to": "0x3E7", "exclude": ["0x100-0x11F", "0x200"] },
 *              "vars": { "from": "0x4034", "to": "0x40FF" }, "hiddenItems": { "from": 1, "to": 255 },
 *              "trainers": { "from": 1, "to": 742 } } }
 * ```
 * 数は 10 進の数か `"0x"` の 16 進の文字列。種類や項目を省くと既定の範囲。ZigzaguMap はこの節を書かない（手で書く）。
 */
export function parseUsageConfig(text: string | null, path: string | null = SCRIPT_CONFIG_FILE): UsageConfig {
  if (text === null || text.trim() === "") return DEFAULT_USAGE_CONFIG;
  const root: JsonRecord = parseJsonObject(text, path);
  const raw = root[USAGE_CONFIG_SECTION];
  if (raw === undefined || raw === null) return DEFAULT_USAGE_CONFIG;
  const section = asRecord(raw, USAGE_CONFIG_SECTION, path);
  const out = { ...DEFAULT_USAGE_CONFIG } as Record<UsageKind, UsageRange>;
  for (const kind of USAGE_KINDS) {
    const key = KEY_OF[kind];
    const v = section[key];
    if (v === undefined || v === null) continue;
    const o = asRecord(v, `${USAGE_CONFIG_SECTION}.${key}`, path);
    const base = DEFAULT_USAGE_CONFIG[kind];
    const from = o.from === undefined ? base.from : readNumber(o.from, `${key}.from`, path);
    const to = o.to === undefined ? base.to : readNumber(o.to, `${key}.to`, path);
    if (to < from) throw new ProjectFormatError(`${USAGE_CONFIG_SECTION}.${key} の to が from より小さいです`, path);
    const exclude: [number, number][] = [];
    if (o.exclude !== undefined && o.exclude !== null) {
      if (!Array.isArray(o.exclude)) throw new ProjectFormatError(`${USAGE_CONFIG_SECTION}.${key}.exclude は配列でなければなりません`, path);
      for (const [i, e] of o.exclude.entries()) exclude.push(readSpan(e, `${key}.exclude[${i}]`, path));
    }
    out[kind] = { from, to, exclude };
  }
  return out;
}

/** プロジェクトの設定を読む（ファイルが無ければ既定値）。 */
export async function loadUsageConfig(fs: ProjectFs | null): Promise<UsageConfig> {
  if (!fs) return DEFAULT_USAGE_CONFIG;
  return parseUsageConfig(await readTextIfExists(fs, SCRIPT_CONFIG_FILE));
}

/** 範囲の中で使えない番号か（exclude の区間）。 */
export function isExcluded(range: UsageRange, value: number): boolean {
  return range.exclude.some(([a, b]) => value >= a && value <= b);
}

function readNumber(value: unknown, key: string, path: string | null): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseNumberText(value) : null;
  if (n === null || !Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new ProjectFormatError(`${USAGE_CONFIG_SECTION}.${key} は 0〜0xFFFF の数（10 進か "0x" の 16 進）でなければなりません`, path);
  }
  return n;
}

function readSpan(value: unknown, key: string, path: string | null): [number, number] {
  if (typeof value === "string" && value.includes("-")) {
    const [a, b] = value.split("-", 2).map((s) => s.trim());
    const from = readNumber(a, key, path);
    const to = readNumber(b, key, path);
    if (to < from) throw new ProjectFormatError(`${USAGE_CONFIG_SECTION}.${key} の区間が逆です`, path);
    return [from, to];
  }
  const n = readNumber(value, key, path);
  return [n, n];
}

function parseNumberText(text: string): number | null {
  const t = text.trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  return null;
}
