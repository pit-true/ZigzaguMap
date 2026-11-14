import type { BlockSelection } from "./EditorState";

/** 袋に入れられるブロックの数の上限。 */
export const MAX_BAG_BLOCKS = 32;

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
 */
export class MixingBag {
  private list: number[] = [];
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
    if (i >= 0) this.list.splice(i, 1);
    else if (this.list.length < MAX_BAG_BLOCKS) this.list.push(block);
    this.notify();
    return i < 0;
  }

  /** 中身を置き換える（自動操作の `bag.set`）。`seed` を渡すと乱数の種も決める。 */
  set(blocks: readonly number[], seed?: number): void {
    this.list = [...new Set(blocks)].slice(0, MAX_BAG_BLOCKS);
    if (seed !== undefined) this.random = seededRandom(seed);
    this.notify();
  }

  /** 空にする。 */
  clear(): void {
    this.list = [];
    this.notify();
  }

  /** 選択に袋を使うか（袋に 2 つ以上あり、選んでいるのが袋の中の 1 ブロック）。 */
  appliesTo(s: BlockSelection): boolean {
    return this.list.length >= 2 && s.width === 1 && s.height === 1 && s.movements === undefined && this.list.includes(s.blocks[0] ?? -1);
  }

  /** 袋の中から 1 つ選ぶ。 */
  pick(): number {
    return this.list[Math.floor(this.random() * this.list.length)] ?? 0;
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
