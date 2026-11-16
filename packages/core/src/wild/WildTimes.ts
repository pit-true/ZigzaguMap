import { WildTime } from "./layout.js";
import type { WildEncounters } from "./types.js";

/**
 * 時間帯ごとの野生の表（Phase6 #436）。
 *
 * - 番号は `maps\BB\MM.json` の `Wild[].Time` と同じ 0 朝・1 昼・2 夕・3 夜（Bochi・ND・Chronos のビルドと同じ）。
 * - 実機（CFRU の `GetCurrentMapWildMonHeader`）は、朝・夕・夜の表にそのマップが無ければ昼の表を使う。
 * - Chronos の深夜は夜の表を使う（ユーザーの返事。深夜の表は作らない）。
 */

/** タブの並び（実機の時刻の順。朝・昼・夕・夜）。 */
export const WILD_TIMES: readonly number[] = [WildTime.Morning, WildTime.Day, WildTime.Evening, WildTime.Night];

/** その時間帯の表（無ければ undefined）。 */
export function wildOfTime(wild: readonly WildEncounters[], time: number): WildEncounters | undefined {
  return wild.find((w) => w.time === time);
}

/** その表にデータのあるエリアがあるか。 */
export function hasWildData(w: WildEncounters | undefined): boolean {
  return !!w && w.areas.some((a) => a.slots.length > 0);
}

/**
 * 実機がその時間帯に使う表の時間帯。その時間帯の表があればそれ、無ければ昼の表、昼も無ければ null（野生が出ない）。
 */
export function usedWildTime(wild: readonly WildEncounters[], time: number): number | null {
  if (hasWildData(wildOfTime(wild, time))) return time;
  if (hasWildData(wildOfTime(wild, WildTime.Day))) return WildTime.Day;
  return null;
}
