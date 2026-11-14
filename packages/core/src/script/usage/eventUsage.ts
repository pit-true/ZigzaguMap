import type { MapEvents } from "../../event/types.js";
import type { MapId } from "../../map/types.js";
import type { MapScriptEntry } from "../../mapscript/types.js";
import type { UsageSite } from "./UsageIndex.js";

/** 変数として数える番号か（0x4000〜 の保存される変数、CFRU が足した 0x5000〜 の変数、0x8000〜 の特別な変数）。 */
export function isVariableNumber(value: number): boolean {
  return value >= 0x4000 && value <= 0x80ff;
}

/**
 * マップのイベントとマップスクリプトの条件表が使う番号（#227）。
 * - 人のフラグ（0 は「無し」なので数えない）。
 * - スクリプトタイルの変数（0x4000 未満は変数ではないので数えない）。
 * - 隠しアイテムの看板の番号（フラグは 0x3E8 + 番号。UsageIndex が両方を見る）。
 * - マップスクリプトの条件表（種類 2・4）の変数。
 */
export function eventUsage(id: MapId, events: MapEvents | null, mapScripts: readonly MapScriptEntry[] | null = null): UsageSite[] {
  const out: UsageSite[] = [];
  const at = `${id.bank}.${id.map}`;
  const map = { bank: id.bank, map: id.map };
  if (events) {
    events.persons.forEach((p, i) => {
      if (p.flag !== 0) out.push({ kind: "flag", value: p.flag, source: "event", where: `maps ${at} 人 ${i}`, map });
    });
    events.traps.forEach((t, i) => {
      if (isVariableNumber(t.variable)) out.push({ kind: "var", value: t.variable, source: "event", where: `maps ${at} スクリプト ${i}`, map });
    });
    events.signs.forEach((s, i) => {
      if (s.content.type === "hiddenItem") out.push({ kind: "hiddenItem", value: s.content.flag, source: "event", where: `maps ${at} 看板 ${i}`, map });
    });
  }
  for (const entry of mapScripts ?? []) {
    for (const row of entry.table?.entries ?? []) {
      if (isVariableNumber(row.variable)) out.push({ kind: "var", value: row.variable, source: "event", where: `maps ${at} マップスクリプト ${entry.type}`, map });
    }
  }
  return out;
}

/**
 * マップのイベントから、素の ROM のスクリプトの入口（ROM の中の位置）を集める。
 * 人・看板（スクリプトのもの）・スクリプトタイル・マップスクリプト（条件表の行き先も）のポインタのうち、ROM の中を指すもの。
 * `itemBallPersons` は落とし物の人（スクリプトは HiddenItem.s にあるので入れない）。
 */
export function romScriptEntries(
  events: MapEvents | null,
  mapScripts: readonly MapScriptEntry[] | null,
  inRom: (pointer: number) => number | null,
  itemBallPersons: ReadonlySet<number> = new Set(),
): number[] {
  const out = new Set<number>();
  const add = (pointer: number): void => {
    const o = inRom(pointer);
    if (o !== null) out.add(o);
  };
  if (events) {
    events.persons.forEach((p, i) => {
      if (!itemBallPersons.has(i)) add(p.script);
    });
    for (const s of events.signs) if (s.content.type === "script") add(s.content.script);
    for (const t of events.traps) add(t.script);
  }
  for (const e of mapScripts ?? []) {
    if (e.table) for (const row of e.table.entries) add(row.script);
    else add(e.pointer);
  }
  return [...out];
}
