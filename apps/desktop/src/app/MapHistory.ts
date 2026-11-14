import type { MapId } from "@zigzagumap/core";

/** 履歴の上限（戻る・進むそれぞれ）。 */
export const MAP_HISTORY_LIMIT = 50;

function same(a: MapId, b: MapId): boolean {
  return a.bank === b.bank && a.map === b.map;
}

/**
 * 開いたマップの履歴（#237。戻る・進む）。ブラウザと同じく、別のマップを開くと今のマップを「戻る」に積み、「進む」を空にする。
 * 戻ると今のマップを「進む」に積む。開けなくなったマップ（取り消した作業用のマップなど）は、戻るときに飛ばす。
 */
export class MapHistory {
  private backStack: MapId[] = [];
  private forwardStack: MapId[] = [];

  constructor(readonly limit = MAP_HISTORY_LIMIT) {}

  /** `from` から `to` へ開いた（戻る・進む以外の開き方）。 */
  visit(from: MapId | null, to: MapId): void {
    if (!from || same(from, to)) return;
    this.backStack.push(from);
    if (this.backStack.length > this.limit) this.backStack.shift();
    this.forwardStack = [];
  }

  /** 戻る先（`valid` が false のものは捨てる）。今のマップを「進む」に積む。無ければ null。 */
  back(current: MapId | null, valid: (id: MapId) => boolean = () => true): MapId | null {
    return this.step(this.backStack, this.forwardStack, current, valid);
  }

  /** 進む先。今のマップを「戻る」に積む。無ければ null。 */
  forward(current: MapId | null, valid: (id: MapId) => boolean = () => true): MapId | null {
    return this.step(this.forwardStack, this.backStack, current, valid);
  }

  private step(from: MapId[], to: MapId[], current: MapId | null, valid: (id: MapId) => boolean): MapId | null {
    while (from.length > 0) {
      const target = from.pop()!;
      if (!valid(target) || (current && same(target, current))) continue;
      if (current) {
        to.push(current);
        if (to.length > this.limit) to.shift();
      }
      return target;
    }
    return null;
  }

  /** 戻る・進むを取り消す（開けなかったとき）。`step` の前の形に戻す。 */
  undoStep(direction: "back" | "forward", target: MapId, current: MapId | null): void {
    const [from, to] = direction === "back" ? [this.backStack, this.forwardStack] : [this.forwardStack, this.backStack];
    if (current && to.length > 0 && same(to[to.length - 1]!, current)) to.pop();
    from.push(target);
  }

  /** 1 つ前のマップ（戻る先。無ければ null）。 */
  get previous(): MapId | null {
    return this.backStack.at(-1) ?? null;
  }

  get canBack(): boolean {
    return this.backStack.length > 0;
  }

  get canForward(): boolean {
    return this.forwardStack.length > 0;
  }

  /** 空にする（別の ROM を開いたとき）。 */
  clear(): void {
    this.backStack = [];
    this.forwardStack = [];
  }

  /** 中身（自動操作の `history.state`）。古い順。 */
  snapshot(): { back: MapId[]; forward: MapId[] } {
    return { back: [...this.backStack], forward: [...this.forwardStack].reverse() };
  }
}
