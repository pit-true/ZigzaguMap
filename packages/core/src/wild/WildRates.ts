/**
 * 野生の枠ごとの出現の割合と、種族・レベルの集計と、種族の全マップ検索（Phase5 #398）。DOM に依存しない計算だけを置く。
 *
 * 割合はゲームの処理で決まる値（ND と Chronos の `src/dexnav.c` の sLandEncounterRates・sWaterEncounterRates・
 * sFishingEncounterRates と同じ）。釣りの 10 枠は、ボロ（0・1）・いい（2〜4）・すごい（5〜9）の竿ごとに 100%。
 */
import { WildAreaKind } from "./layout.js";
import type { WildArea, WildEncounters } from "./types.js";
import type { MapId } from "../map/types.js";

/** 草むらの 12 枠（%）。 */
export const LAND_SLOT_RATES: readonly number[] = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1];
/** 水と岩砕きの 5 枠（%）。 */
export const WATER_SLOT_RATES: readonly number[] = [60, 30, 5, 4, 1];
/** 釣りの 10 枠（%。竿ごとに合計 100）。 */
export const FISHING_SLOT_RATES: readonly number[] = [70, 30, 60, 20, 20, 40, 40, 15, 4, 1];
/** 釣りの竿の番号（0 ボロ・1 いい・2 すごい）を枠ごとに。 */
export const FISHING_SLOT_RODS: readonly number[] = [0, 0, 1, 1, 1, 2, 2, 2, 2, 2];

/** そのエリアの枠の割合（%）。表に無い枠は 0。 */
export function slotRate(kind: number, slot: number): number {
  const table = kind === WildAreaKind.Land ? LAND_SLOT_RATES : kind === WildAreaKind.Fishing ? FISHING_SLOT_RATES : WATER_SLOT_RATES;
  return table[slot] ?? 0;
}

/** 割合を数える単位（釣りは竿ごと。ほかはエリア全体で 1 つ）。 */
export function rateGroup(kind: number, slot: number): number {
  return kind === WildAreaKind.Fishing ? (FISHING_SLOT_RODS[slot] ?? 0) : 0;
}

/** 種族ごとの合計の割合（`group` を渡すと釣りのその竿だけ）。割合の大きい順。 */
export function speciesTotals(kind: number, area: WildArea, group: number | null = null): { species: number; rate: number }[] {
  const totals = new Map<number, number>();
  area.slots.forEach((s, i) => {
    if (group !== null && rateGroup(kind, i) !== group) return;
    totals.set(s.species, (totals.get(s.species) ?? 0) + slotRate(kind, i));
  });
  return [...totals].map(([species, rate]) => ({ species, rate })).sort((a, b) => b.rate - a.rate || a.species - b.species);
}

/**
 * レベルの分布（%）。枠の割合を、その枠の最低〜最高のレベルに等しく分ける（ゲームと同じく範囲の中から一様に選ぶ）。
 * `species` を渡すとその種族の枠だけ（割合はエリア全体に対する値のまま）。`group` は釣りの竿。
 */
export function levelDistribution(kind: number, area: WildArea, species: number | null = null, group: number | null = null): Map<number, number> {
  const out = new Map<number, number>();
  area.slots.forEach((s, i) => {
    if (species !== null && s.species !== species) return;
    if (group !== null && rateGroup(kind, i) !== group) return;
    const lo = Math.min(s.minLevel, s.maxLevel);
    const hi = Math.max(s.minLevel, s.maxLevel);
    const share = slotRate(kind, i) / (hi - lo + 1);
    for (let lv = lo; lv <= hi; lv++) out.set(lv, (out.get(lv) ?? 0) + share);
  });
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** 検索の 1 行。 */
export interface WildSearchRow {
  readonly map: MapId;
  /** エリア（0 陸・1 水・2 岩砕き・3 釣り）。 */
  readonly kind: number;
  /** 枠（0 から）。 */
  readonly slot: number;
  readonly minLevel: number;
  readonly maxLevel: number;
  /** 枠の割合（%）。 */
  readonly rate: number;
}

/** 種族 `species` が出る枠を、渡したマップの野生（表示している時間帯の表）から集める。 */
export function searchSpecies(maps: Iterable<{ id: MapId; wild: WildEncounters | null }>, species: number): WildSearchRow[] {
  const rows: WildSearchRow[] = [];
  for (const m of maps) {
    if (!m.wild) continue;
    m.wild.areas.forEach((area, kind) => {
      area.slots.forEach((s, slot) => {
        if (s.species === species) rows.push({ map: m.id, kind, slot, minLevel: s.minLevel, maxLevel: s.maxLevel, rate: slotRate(kind, slot) });
      });
    });
  }
  return rows;
}
