import type { WildEncounters } from "../wild/types.js";
import type { TrainerMon } from "./TrainerTable.js";

/** 野生の種族 1 つ（その場所で出る最高のレベル）。 */
export interface WildCandidate {
  readonly species: number;
  readonly maxLevel: number;
}

/** 自動生成の結果。 */
export interface GeneratedTeam {
  readonly party: TrainerMon[];
  /** 使った乱数の種。 */
  readonly seed: number;
  /** 候補にした野生（無ければ空。そのときは種族を選んでもらう）。 */
  readonly candidates: readonly WildCandidate[];
}

/** 種から決まる乱数（mulberry32）。同じ種なら同じ並び。 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 野生の表（全時間帯・全区分）から、種族ごとの最高のレベルを集める。種族 0 は数えない。
 * `encounters` は 1 枚のマップの `WildEncounters`（時間帯ごと）。複数のマップを渡せば合わせる。
 */
export function wildCandidates(encounters: readonly WildEncounters[]): WildCandidate[] {
  const max = new Map<number, number>();
  for (const e of encounters) {
    for (const area of e.areas) {
      for (const slot of area.slots) {
        if (slot.species === 0) continue;
        max.set(slot.species, Math.max(max.get(slot.species) ?? 0, slot.maxLevel, slot.minLevel));
      }
    }
  }
  return [...max.entries()].sort((a, b) => a[0] - b[0]).map(([species, maxLevel]) => ({ species, maxLevel }));
}

/**
 * チームの自動生成（#245。Q3 の推奨の案）。
 * - 種族は、このマップと隣のマップの野生（`candidates`）から選ぶ（同じ種族が続いてもよい）。
 * - 数は 1〜3 匹。レベルは、その場所の野生の最高レベルから 0〜+2（100 まで）。
 * - 手持ちの形式は 0（技と持ち物を書かない。技はゲームがレベルアップの表から決める）。個体値は 0。
 * - 乱数の種を決めると同じ結果になる（テストと元に戻すのため）。候補が無ければ空の手持ちを返す（種族を選んでもらう）。
 */
export function generateTeam(candidates: readonly WildCandidate[], seed: number): GeneratedTeam {
  if (candidates.length === 0) return { party: [], seed, candidates };
  const rnd = seededRandom(seed);
  const top = Math.max(...candidates.map((c) => c.maxLevel));
  const count = 1 + Math.floor(rnd() * 3);
  const party: TrainerMon[] = [];
  for (let i = 0; i < count; i++) {
    const c = candidates[Math.floor(rnd() * candidates.length)]!;
    party.push({ iv: 0, level: Math.min(100, Math.max(1, top + Math.floor(rnd() * 3))), species: c.species });
  }
  return { party, seed, candidates };
}
