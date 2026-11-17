import { pickWeighted } from "@zigzagumap/core";
import type { BlockSelection } from "./EditorState";

/** 袋に入れられるブロックの数の上限。 */
export const MAX_BAG_BLOCKS = 32;

/** 重みの下限・上限（Phase7 #515）。 */
export const MIN_BAG_WEIGHT = 1;
export const MAX_BAG_WEIGHT = 9;

/** 重みを 1〜9 の整数に収める（読めなければ 1）。 */
export function clampBagWeight(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : MIN_BAG_WEIGHT;
  return Math.min(MAX_BAG_WEIGHT, Math.max(MIN_BAG_WEIGHT, n));
}

/** 種を決めた乱数（mulberry32。テストで同じ並びにするため）。0 以上 1 未満を返す。 */
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
 * ミキシングバッグ（#236。HMA と同じ）: Ctrl＋パレットの左クリックでブロックを出し入れする袋。
 * 袋に 2 つ以上入っていて、選んでいるブロック（1 つ）が袋の中にあるとき、鉛筆・矩形塗り・境界をまたぐ描画は袋の中から乱数で選んで描く。
 * 選んだ結果はコマンドの引数（各マスのブロック）に残るので、やり直し・操作列の再生では同じ絵になる。
 * Phase7 #515: ブロックごとの重み（1〜9。既定 1）で選ぶ割合を変える。重みは袋の中身と同じく保存しない。
 * 重みが全部 1 なら、重みを付ける前と同じ乱数の使い方（同じ種なら同じ並び）。
 */
export class MixingBag {
  private list: number[] = [];
  private weights = new Map<number, number>();
  private random: () => number = seededRandom(Date.now());
  private readonly listeners = new Set<() => void>();

  /** 袋の中身（入れた順）。 */
  get blocks(): readonly number[] {
    return this.list;
  }

  /** 変わったときに呼ぶ。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 出し入れする（入っていれば出し、無ければ入れる）。入れたら true。 */
  toggle(block: number): boolean {
    const i = this.list.indexOf(block);
    if (i >= 0) {
      this.list.splice(i, 1);
      this.weights.delete(block);
    }
    else if (this.list.length < MAX_BAG_BLOCKS) this.list.push(block);
    this.notify();
    return i < 0;
  }

  /** ブロックの重み（袋に無ければ 1）。 */
  weightOf(block: number): number {
    return this.weights.get(block) ?? MIN_BAG_WEIGHT;
  }

  /** 袋の中のブロックの重みを変える（1〜9 に収める。袋に無いブロックや同じ値なら何もしない）。変えたら true。 */
  setWeight(block: number, weight: number): boolean {
    const w = clampBagWeight(weight);
    if (!this.list.includes(block) || this.weightOf(block) === w) return false;
    if (w === MIN_BAG_WEIGHT) this.weights.delete(block);
    else this.weights.set(block, w);
    this.notify();
    return true;
  }

  /** 中身を置き換える（自動操作の `bag.set`）。`seed` を渡すと乱数の種も決める。`weights` は中身と同じ順の重み（無ければ全部 1）。 */
  set(blocks: readonly number[], seed?: number, weights?: readonly number[]): void {
    this.list = [...new Set(blocks)].slice(0, MAX_BAG_BLOCKS);
    this.weights = new Map();
    if (weights) {
      blocks.forEach((b, i) => {
        const w = clampBagWeight(weights[i]);
        if (this.list.includes(b) && w !== MIN_BAG_WEIGHT && !this.weights.has(b)) this.weights.set(b, w);
      });
    }
    if (seed !== undefined) this.random = seededRandom(seed);
    this.notify();
  }

  /** 空にする。 */
  clear(): void {
    this.list = [];
    this.weights = new Map();
    this.notify();
  }

  /** 選択に袋を使うか（袋に 2 つ以上あり、選んでいるのが袋の中の 1 ブロック）。 */
  appliesTo(s: BlockSelection): boolean {
    return this.list.length >= 2 && s.width === 1 && s.height === 1 && s.movements === undefined && this.list.includes(s.blocks[0] ?? -1);
  }

  /** 袋の中から重みで 1 つ選ぶ。 */
  pick(): number {
    return this.list[pickWeighted(this.list.map((b) => this.weightOf(b)), this.random())] ?? 0;
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
