import { PRIMARY_BLOCK_COUNT } from "../map/constants.js";
import type { Tileset } from "../map/types.js";
import { isTripleLayer, localAttribute, thirdLayerLocal } from "../tileset/tripleLayer.js";
import { tileAnimationFrame, type TileAnimationSet } from "./TileAnimations.js";

/** タイルアニメの GIF（Phase7 #514）で、1 回分として描くフレームの範囲。 */
export interface TileAnimationLoop {
  /** 最初のフレーム（MapBGanimeMain を呼んだ回数。全部のトラックが一度は差し替えた後）。 */
  readonly start: number;
  /** 描くフレームの数（60 分の 1 秒単位）。 */
  readonly length: number;
  /** 全部のアニメの周期がそろう長さ（上限で切っていなければ `length` と同じ）。 */
  readonly period: number;
  /** 上限で切らずに、1 周がつながるか。 */
  readonly complete: boolean;
}

/** GIF の 1 コマ（どのフレームの絵を、何 1/100 秒出すか）。 */
export interface TileAnimationKeyFrame {
  readonly frame: number;
  readonly delayCs: number;
}

/** 最大公約数。 */
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** 最小公倍数。 */
function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/**
 * タイルアニメの組（主と副など）の絵がそろって元に戻る長さ（フレーム）。トラックの 1 周（周期 × コマ数）がどれもカウンタの上限で
 * 割り切れる組はトラックの 1 周の最小公倍数、割り切れない組はカウンタの上限で繰り返す。全部の組の最小公倍数。動くものが無ければ 0。
 */
export function tileAnimationPeriod(sets: readonly (TileAnimationSet | null)[]): number {
  let period = 0;
  for (const set of sets) {
    if (!set || set.tracks.length === 0 || set.counterMax < 1) continue;
    let p = 1;
    let divides = true;
    for (const t of set.tracks) {
      const cycle = t.period * t.frames.length;
      if (cycle < 1 || set.counterMax % cycle !== 0) divides = false;
      else p = lcm(p, cycle);
    }
    const setPeriod = divides ? p : set.counterMax;
    period = period === 0 ? setPeriod : lcm(period, setPeriod);
  }
  return period;
}

/**
 * GIF にする範囲。`maxFrames` を超える周期は `maxFrames` で切る（`complete` が false）。始まりはカウンタが一度 0 に戻った後
 * （どのトラックも差し替え済みで、周期どおりに繰り返す所）。動くものが無ければ null。
 */
export function tileAnimationLoop(sets: readonly (TileAnimationSet | null)[], maxFrames: number): TileAnimationLoop | null {
  const period = tileAnimationPeriod(sets);
  if (period === 0) return null;
  const counterMax = Math.max(...sets.map((s) => s?.counterMax ?? 0));
  const start = Math.ceil((counterMax + 1) / period) * period;
  const length = Math.min(period, Math.max(1, Math.floor(maxFrames)));
  return { start, length, period, complete: length === period };
}

/** フレーム `elapsed` の、全部のトラックのコマの番号（絵が同じか見比べる鍵）。 */
export function tileAnimationSignature(sets: readonly (TileAnimationSet | null)[], elapsed: number): string {
  const parts: string[] = [];
  for (const set of sets) {
    if (!set) continue;
    for (const t of set.tracks) parts.push(String(tileAnimationFrame(set.counterMax, t, elapsed)));
  }
  return parts.join(",");
}

/** GIF の 1 コマの最短（1/100 秒。これより短い間はブラウザなどが 0.1 秒に延ばすので作らない）。 */
export const GIF_MIN_DELAY_CS = 2;

/**
 * 絵が変わったフレームだけをコマにする（Phase7 #514）。コマの長さは変わるまでのフレーム数 × 1/60 秒を 1/100 秒に丸めたもの
 * （丸めの誤差がたまらないよう、始まりからの時刻で丸める）。2/100 秒より短いコマは作らず、続くコマの絵で埋める。
 */
export function tileAnimationKeyFrames(sets: readonly (TileAnimationSet | null)[], loop: Pick<TileAnimationLoop, "start" | "length">): TileAnimationKeyFrame[] {
  const changes: number[] = [];
  let last: string | null = null;
  for (let i = 0; i < loop.length; i++) {
    const key = tileAnimationSignature(sets, loop.start + i);
    if (key !== last) changes.push(i);
    last = key;
  }
  const time = (i: number): number => Math.round((i * 100) / 60);
  // 短いコマは、次の変わり目の絵で置き換える（時刻は前の変わり目のまま）
  const kept: { at: number; frame: number }[] = [];
  for (const i of changes) {
    const prev = kept[kept.length - 1];
    if (prev && time(i) - time(prev.at) < GIF_MIN_DELAY_CS) prev.frame = i;
    else kept.push({ at: i, frame: i });
  }
  // 最後のコマが短ければ前のコマに足す
  if (kept.length > 1 && time(loop.length) - time(kept[kept.length - 1]!.at) < GIF_MIN_DELAY_CS) kept.pop();
  return kept.map((k, n) => ({
    frame: loop.start + k.frame,
    delayCs: time(n + 1 < kept.length ? kept[n + 1]!.at : loop.length) - time(k.at),
  }));
}

/**
 * ブロックの並びが使うタイルの番号（通し番号。主 0〜0x27F、副 0x280〜）。下・上のレイヤーと、トリプルレイヤーの 3 枚目
 * （同じ表の次のブロックの下 4 タイル）を含む。`out` に足す。
 */
export function addUsedTiles(primary: Tileset, secondary: Tileset, blocks: Iterable<number>, out: Set<number>): Set<number> {
  const seen = new Set<number>();
  for (const block of blocks) {
    if (seen.has(block)) continue;
    seen.add(block);
    const isPrimary = block < PRIMARY_BLOCK_COUNT;
    const table = isPrimary ? primary : secondary;
    const local = isPrimary ? block : block - PRIMARY_BLOCK_COUNT;
    if (local < 0 || local * 8 + 8 > table.blocks.length) continue;
    for (let i = 0; i < 8; i++) out.add(table.blocks[local * 8 + i]! & 0x3ff);
    if (isTripleLayer(localAttribute(table, local))) {
      const third = thirdLayerLocal(table, local);
      if (third !== null) for (let i = 0; i < 4; i++) out.add(table.blocks[third * 8 + i]! & 0x3ff);
    }
  }
  return out;
}

/** 使うタイルに当たるトラックだけを残した組（どれも当たらなければ null）。GIF の長さを、見えるアニメだけで決めるため。 */
export function visibleTileAnimation(set: TileAnimationSet | null, used: ReadonlySet<number>): TileAnimationSet | null {
  if (!set) return null;
  const tracks = set.tracks.filter((t) => {
    for (let i = 0; i < t.tileCount; i++) if (used.has(t.tileStart + i)) return true;
    return false;
  });
  return tracks.length ? { ...set, tracks } : null;
}
