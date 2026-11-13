import type { Command } from "@zigzagumap/core";

/** 下書きの 1 件。`src` は下書きを作ったときの元の番号（追加した件は null）。 */
export interface DraftItem<T> {
  value: T;
  readonly src: number | null;
}

/** 下書きを編集中の状態へ反映するコマンドの作り方。 */
export interface DraftOps<T> {
  /** `index` の件を消す。 */
  remove(index: number): Command;
  /** `index` の件を `before` から `after` へ変える（変わらなければ空の配列）。 */
  update(index: number, before: T, after: T): Command[];
  /** 末尾（`index` 番）に `after` を足す。 */
  add(index: number, after: T): Command[];
}

/**
 * 一覧の下書き（AdvanceMap のメモリ上の表）。追加は末尾だけ、並べ替えは無いので、
 * 元の件は元の順のまま並び、その後ろに追加した件が続く。
 * 「保存」で、消した件の削除（後ろから）→ 残った件の変更 → 追加した件の追加、の順のコマンドにする。
 */
export class DraftList<T> {
  items: DraftItem<T>[];
  /** 下書きを作ったときの元の一覧の写し（外で変わったかを見る）。 */
  private baseKey: string;

  constructor(
    source: readonly T[],
    private readonly copy: (value: T) => T,
    private readonly key: (list: readonly T[]) => string,
  ) {
    this.items = source.map((value, src) => ({ value: copy(value), src }));
    this.baseKey = key(source);
  }

  /** 元の一覧が下書きを作ったときと違うか（アンドゥなどで外から変わった）。 */
  isStale(source: readonly T[]): boolean {
    return this.key(source) !== this.baseKey;
  }

  /** 元の一覧と同じ内容か（保存するものが無いか）。 */
  isClean(source: readonly T[]): boolean {
    return this.items.length === source.length && this.items.every((d, i) => d.src === i) && this.key(this.items.map((d) => d.value)) === this.key(source);
  }

  add(value: T): number {
    this.items.push({ value, src: null });
    return this.items.length - 1;
  }

  remove(index: number): void {
    this.items.splice(index, 1);
  }

  /** 元の一覧 `source` をこの下書きにするコマンド。 */
  plan(source: readonly T[], ops: DraftOps<T>): Command[] {
    const kept = new Set(this.items.map((d) => d.src).filter((s): s is number => s !== null));
    const commands: Command[] = [];
    for (let i = source.length - 1; i >= 0; i--) if (!kept.has(i)) commands.push(ops.remove(i));
    let index = 0;
    for (const d of this.items) {
      if (d.src === null) continue;
      commands.push(...ops.update(index, source[d.src]!, d.value));
      index++;
    }
    for (const d of this.items) {
      if (d.src !== null) continue;
      commands.push(...ops.add(index, d.value));
      index++;
    }
    return commands;
  }
}
