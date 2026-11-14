import { formatHex } from "../../binary/bytes.js";
import type { MapScriptEntry } from "../../mapscript/types.js";
import { isScriptLabelName } from "./LabelNaming.js";

/** マップスクリプトの種類（1〜7）。2 と 4 は条件表を指す。 */
export const MAP_SCRIPT_TYPE_NAMES: readonly string[] = [
  "MAP_SCRIPT_TERMIN",
  "MAP_SCRIPT_ON_LOAD",
  "MAP_SCRIPT_ON_FRAME_TABLE",
  "MAP_SCRIPT_ON_TRANSITION",
  "MAP_SCRIPT_ON_WARP_INTO_MAP_TABLE",
  "MAP_SCRIPT_ON_RESUME",
  "MAP_SCRIPT_ON_DIVE_WARP",
  "MAP_SCRIPT_ON_RETURN_TO_FIELD",
];

/** 種類が条件表を指すか（2: ON_FRAME_TABLE、4: ON_WARP_INTO_MAP_TABLE）。 */
export function isMapScriptTableType(type: number): boolean {
  return type === 2 || type === 4;
}

/** 条件表の 1 行（変数が値のときに動くスクリプト）。 */
export interface MapScriptCondition {
  readonly variable: number;
  readonly value: number;
  /** 行き先（ラベル名か `0x0816F58D` のようなアドレス）。 */
  readonly script: string;
}

/** 表の 1 件。条件表の種類なら `conditions`、ほかは `script`。 */
export interface MapScriptItem {
  readonly type: number;
  /** 行き先（条件表の種類では使わない）。 */
  readonly script: string;
  /** 条件表（条件表の種類だけ）。 */
  readonly conditions: readonly MapScriptCondition[];
}

/** `.s` に書くマップスクリプトの表。 */
export interface MapScriptTableModel {
  /** 表のラベル（eventscripts の `map` の行が指す）。 */
  readonly label: string;
  readonly items: readonly MapScriptItem[];
}

/** 条件表のラベル（`<表のラベル>_<種類の名前>`）。 */
export function mapScriptConditionTableLabel(label: string, type: number): string {
  return `${label}_${type === 2 ? "FrameTable" : "WarpIntoTable"}`;
}

const MARK = "@ ZigzaguMap:";
const startMark = (label: string): string => `${MARK} マップスクリプトの表 ${label}（ここから「ここまで」の行までは ZigzaguMap が書き直す）`;
const endMark = (label: string): string => `${MARK} ここまで（${label}）`;

/**
 * 表を `.s` の行にする（前後に ZigzaguMap の印の行。`mapscript` と `levelscript` は xse_commands.s のマクロ）。
 * ```
 * Moegi_MapScripts:
 * 	mapscript MAP_SCRIPT_ON_LOAD Moegi_OnLoad
 * 	mapscript MAP_SCRIPT_ON_FRAME_TABLE Moegi_MapScripts_FrameTable
 * 	.byte MAP_SCRIPT_TERMIN
 *
 * .align 1
 * Moegi_MapScripts_FrameTable:
 * 	levelscript 0x4050 0x0 Moegi_Frame0
 * 	.hword 0
 * ```
 */
export function mapScriptTableLines(table: MapScriptTableModel, useGlobal: boolean): string[] {
  const out = [startMark(table.label)];
  if (useGlobal) out.push(`.global ${table.label}`);
  out.push(`${table.label}:`);
  for (const item of table.items) {
    const target = isMapScriptTableType(item.type) ? mapScriptConditionTableLabel(table.label, item.type) : item.script;
    out.push(`\tmapscript ${MAP_SCRIPT_TYPE_NAMES[item.type] ?? hex(item.type)} ${target}`);
  }
  out.push("\t.byte MAP_SCRIPT_TERMIN");
  for (const item of table.items) {
    if (!isMapScriptTableType(item.type)) continue;
    out.push("", ".align 1", `${mapScriptConditionTableLabel(table.label, item.type)}:`);
    for (const c of item.conditions) out.push(`\tlevelscript ${hex(c.variable)} ${hex(c.value)} ${c.script}`);
    out.push("\t.hword 0");
  }
  out.push(endMark(table.label));
  return out;
}

function hex(n: number): string {
  return `0x${formatHex(n)}`;
}

/** `.s` の中の表の位置（行の番号は 0 から。`end` はその行を含む）。 */
export interface MapScriptTableSpan {
  readonly start: number;
  readonly end: number;
}

/** `.s` の行から、ZigzaguMap が書いた表を探す。無ければ null。 */
export function findMapScriptTable(lines: readonly string[], label: string): MapScriptTableSpan | null {
  const start = lines.findIndex((l) => l.trim() === startMark(label));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) if (lines[i]!.trim() === endMark(label)) return { start, end: i };
  return null;
}

/** 表の本文を読み直す（手で書き換えていても `mapscript` と `levelscript` の行が読めれば使う）。読めなければ null。 */
export function parseMapScriptTable(lines: readonly string[], label: string): MapScriptTableModel | null {
  const span = findMapScriptTable(lines, label);
  if (!span) return null;
  const body = lines.slice(span.start + 1, span.end).map((l) => l.replace(/@.*$/, "").trim());
  const items: { type: number; script: string; conditions: MapScriptCondition[] }[] = [];
  const tables = new Map<string, MapScriptCondition[]>();
  let table: MapScriptCondition[] | null = null;
  for (const line of body) {
    if (line === "" || line.startsWith(".global") || line.startsWith(".align") || line === `${label}:`) continue;
    const def = /^([A-Za-z_.$][\w.$]*):$/.exec(line);
    if (def) {
      table = [];
      tables.set(def[1]!, table);
      continue;
    }
    const words = line.split(/[\s,]+/);
    if (words[0] === "mapscript" && words.length === 3) {
      const type = typeNumber(words[1]!);
      if (type === null) return null;
      items.push({ type, script: words[2]!, conditions: [] });
    } else if (words[0] === "levelscript" && words.length === 4 && table) {
      const variable = Number(words[1]);
      const value = Number(words[2]);
      if (!Number.isInteger(variable) || !Number.isInteger(value)) return null;
      table.push({ variable, value, script: words[3]! });
    } else if (!/^\.byte\s+(MAP_SCRIPT_TERMIN|0x0|0)$/.test(line) && !/^\.hword\s+(0x0|0)$/.test(line)) {
      return null;
    }
  }
  return {
    label,
    items: items.map((i) => (isMapScriptTableType(i.type) ? { type: i.type, script: "", conditions: tables.get(i.script) ?? [] } : i)),
  };
}

function typeNumber(word: string): number | null {
  const named = MAP_SCRIPT_TYPE_NAMES.indexOf(word);
  if (named > 0) return named;
  const n = Number(word);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

/**
 * `.s` のテキストの表を書き換える（無ければ最後に足す。`table` が null なら消す）。改行はファイルの形に合わせる。
 * 返すのは新しいテキスト。
 */
export function replaceMapScriptTable(text: string, label: string, table: MapScriptTableModel | null, useGlobal: boolean): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const span = findMapScriptTable(lines, label);
  const next = table ? mapScriptTableLines(table, useGlobal) : [];
  if (span) {
    // 消すときは、前の空行も 1 つ除く
    const from = !table && span.start > 0 && lines[span.start - 1] === "" ? span.start - 1 : span.start;
    lines.splice(from, span.end - from + 1, ...next);
    return lines.join(newline);
  }
  if (!table) return text;
  const body = text === "" || text.endsWith("\n") ? text : text + newline;
  return body + newline + next.join(newline) + newline;
}

/** 行き先がラベルかアドレスとして書けるか。 */
export function isMapScriptTarget(script: string): boolean {
  return isScriptLabelName(script) || /^0x[0-9A-Fa-f]{1,8}$/.test(script);
}

/** 種類ごとの行き先のラベルの後ろの名前（xse_defines.s の名前の後ろの部分）。 */
export const MAP_SCRIPT_TYPE_SUFFIXES: Readonly<Record<number, string>> = {
  1: "OnLoad",
  2: "OnFrame",
  3: "OnTransition",
  4: "OnWarpInto",
  5: "OnResume",
  6: "OnDiveWarp",
  7: "OnReturnToField",
};

/**
 * 表の行き先に付ける新しいラベル（`<表のラベル>_<種類の名前>`。例 `Moegi_MapScripts_OnLoad`）。
 * 「種類を足す」のひな形と ROM の取り込みで使う。`taken` にある名前と重なれば `2` から番号を付ける。
 */
export function mapScriptTargetLabel(tableLabel: string, type: number, taken: (name: string) => boolean): string {
  const base = `${tableLabel}_${MAP_SCRIPT_TYPE_SUFFIXES[type] ?? type}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}${n}`)) return `${base}${n}`;
}

/** 行き先に書くアドレス（`0x0816F58D`）。 */
export function mapScriptAddress(pointer: number): string {
  return `0x${formatHex(pointer >>> 0, 8)}`;
}

/** 行き先がそのアドレスか（`0x` の書き方の違いは見ない）。 */
function isAddressOf(script: string, pointer: number): boolean {
  return /^0x[0-9A-Fa-f]{1,8}$/.test(script) && parseInt(script, 16) >>> 0 === pointer >>> 0;
}

/** 今の ROM（か maps\ の JSON）のマップスクリプトを、アドレスのまま表にする（「表を作る」）。種類 1〜7 だけを使う。 */
export function mapScriptTableFromEntries(label: string, entries: readonly MapScriptEntry[]): MapScriptTableModel {
  const items: MapScriptItem[] = entries
    .filter((e) => e.type >= 1 && e.type <= 7)
    .map((e) =>
      isMapScriptTableType(e.type)
        ? { type: e.type, script: "", conditions: (e.table?.entries ?? []).map((c) => ({ variable: c.variable, value: c.value, script: mapScriptAddress(c.script) })) }
        : { type: e.type, script: mapScriptAddress(e.pointer), conditions: [] },
    );
  return { label, items };
}

/** 行き先がそのアドレスの、最初の件の種類（無ければ null）。 */
export function mapScriptTypeOfAddress(table: MapScriptTableModel, pointer: number): number | null {
  for (const item of table.items) {
    if (isMapScriptTableType(item.type) ? item.conditions.some((c) => isAddressOf(c.script, pointer)) : isAddressOf(item.script, pointer)) return item.type;
  }
  return null;
}

/** 行き先がそのアドレスの件（条件表の行も）をすべて `label` にする。 */
export function retargetMapScriptAddress(table: MapScriptTableModel, pointer: number, label: string): MapScriptTableModel {
  const swap = (script: string): string => (isAddressOf(script, pointer) ? label : script);
  return { ...table, items: table.items.map((i) => ({ ...i, script: swap(i.script), conditions: i.conditions.map((c) => ({ ...c, script: swap(c.script) })) })) };
}
