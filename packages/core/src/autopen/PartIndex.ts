import { allSlotNamesOf, type AutoPenPart, type PartKind } from "./types.js";

/** ブロックが入っている所（パーツ・枠・枠の中の位置）。 */
export interface PartPlace {
  readonly part: AutoPenPart;
  readonly slot: string;
  readonly x: number;
  readonly y: number;
}

/** 同じブロックが複数のパーツにあるときの優先（小さいほど先）。縁つき → くり返し → 部品 → 面。 */
const KIND_RANK: Readonly<Record<PartKind, number>> = { edge: 0, repeat: 1, piece: 2, fill: 3 };

/**
 * 「ブロック → そのブロックを含むパーツと枠」の表（#303）。
 * 重なれば 縁つき → くり返し → 部品 → 面 の順、同じ種類なら並び順（order）の小さいパーツを先にする。
 * 3 層の次の番号（単独で置けないブロック）は表に入れない（`excluded` で渡す）。
 */
export class PartIndex {
  private readonly table = new Map<number, PartPlace[]>();
  readonly parts: readonly AutoPenPart[];

  constructor(parts: readonly AutoPenPart[], excluded: (block: number) => boolean = () => false) {
    this.parts = [...parts].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.order - b.order);
    for (const part of this.parts) {
      for (const slot of allSlotNamesOf(part.kind)) {
        const g = part.slots[slot];
        if (!g) continue;
        for (let i = 0; i < g.cells.length; i++) {
          const c = g.cells[i];
          if (!c || excluded(c.block)) continue;
          let list = this.table.get(c.block);
          if (!list) this.table.set(c.block, (list = []));
          list.push({ part, slot, x: i % g.width, y: Math.floor(i / g.width) });
        }
      }
    }
  }

  /** そのブロックの塗り方に使う所（いちばん先のもの。無ければ null）。 */
  get(block: number): PartPlace | null {
    return this.table.get(block)?.[0] ?? null;
  }

  /** そのブロックが入っている所の全部（優先の順）。 */
  all(block: number): readonly PartPlace[] {
    return this.table.get(block) ?? [];
  }

  /** そのブロックを塗り方に使うパーツ（無ければ null）。 */
  partOf(block: number): AutoPenPart | null {
    return this.get(block)?.part ?? null;
  }

  /** そのブロックがパーツに入っているか（自動で描けるか）。 */
  has(block: number): boolean {
    return this.table.has(block);
  }

  /** そのパーツの中で、そのブロックが入っている枠の名前。 */
  slotsIn(part: AutoPenPart, block: number): string[] {
    const out: string[] = [];
    for (const p of this.all(block)) if (p.part === part && !out.includes(p.slot)) out.push(p.slot);
    return out;
  }

  /** 表に入っているブロックの数。 */
  get size(): number {
    return this.table.size;
  }

  /** 表に入っているブロック。 */
  blocks(): IterableIterator<number> {
    return this.table.keys();
  }
}
