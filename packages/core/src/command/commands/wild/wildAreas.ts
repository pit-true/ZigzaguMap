import type { MapDocument } from "../../../model/MapDocument.js";
import { WILD_AREA_COUNT, WILD_SLOT_COUNTS, WildTime } from "../../../wild/layout.js";
import type { WildArea, WildEncounters } from "../../../wild/types.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";

/** 時間帯の既定値（素の ROM は昼だけ）。 */
export const DEFAULT_WILD_TIME = WildTime.Day;

/** 時間帯を確かめる（0〜3）。 */
export function checkWildTime(time: number): number {
  return checkRange("time", time, 0, 3);
}

/** エリアの番号を確かめる（0 草むら、1 水上、2 岩砕き/木、3 釣り）。 */
export function checkWildArea(area: number): number {
  return checkRange("area", area, 0, WILD_AREA_COUNT - 1);
}

/** その時間帯の野生。無ければ undefined。 */
export function findWild(doc: MapDocument, time: number): WildEncounters | undefined {
  return doc.wild.find((w) => w.time === time);
}

/** データのあるエリアを返す。無ければ EditError（wildAreaMissing）。 */
export function requireWildArea(doc: MapDocument, time: number, area: number): WildArea {
  const a = findWild(doc, time)?.areas[area];
  if (!a || a.slots.length === 0) throw new EditError(EditErrorCode.WildAreaMissing, { time, area });
  return a;
}

/** AdvanceMap で追加したエリアの初期値（出現率 0、全スロット Lv 1〜1、種族 0「選択してください」）。 */
export function newWildArea(area: number): WildArea {
  const count = WILD_SLOT_COUNTS[area] ?? 0;
  return { rate: 0, slots: Array.from({ length: count }, () => ({ minLevel: 1, maxLevel: 1, species: 0 })) };
}
