import type { PenOverlay } from "./PenGrid.js";
import { cellKey } from "./PenGrid.js";
import type { AutoPenPart, PartCell, PartGrid } from "./types.js";

/**
 * 重なって並ぶ木（くり返しのパーツのうち `BodyEdge` を持つもの。#311）。
 *
 * 木 1 本は幅 2・高さ 3（先端・上の段・下の段）。上下に並ぶ木は 2 行おきで、下の木の先端が上の木の下の段に重なる。
 * 枠との対応（どれも左右 2 マス）:
 * - 先端だけ: `Top`。上の段: `Body` の 1 行目（森の端なら `BodyEdge` の 1 行目、真上に木が無ければ `BodyTip`）。
 * - 下の段と先端が重なる所（つなぎ目）: `Body` の 2 行目（森の端なら `BodyEdge` の 2 行目）。
 * - 下の段だけ: `Bottom`（森の端なら `BottomEdge`）。
 * 「森の端」は、そのマスの外側（左の列なら左、右の列なら右）が森でないこと（マップの外は森とみなす）。
 * 木の位置は上の段の左のマスで表す。マップにもうある木は上の段の左のブロックで見分け、新しい木はいちばん近い木と
 * 横 2・縦 2 マスの区切りをそろえる（近くに無ければ描いた範囲の左上）。1 マスずれて重なる古い木は消す。
 */

/** マスに重なる木の段。 */
const Layer = { Tip: 1, Upper: 2, Lower: 4 } as const;
type Layer = (typeof Layer)[keyof typeof Layer];

/** 木のブロック（左右）。 */
interface TreeBlocks {
  readonly tip: readonly (PartCell | null)[];
  readonly upper: readonly (PartCell | null)[];
  readonly upperEdge: readonly (PartCell | null)[];
  readonly upperTip: readonly (PartCell | null)[];
  readonly join: readonly (PartCell | null)[];
  readonly joinEdge: readonly (PartCell | null)[];
  readonly bottom: readonly (PartCell | null)[];
  readonly bottomEdge: readonly (PartCell | null)[];
  /** 木のブロックの全部。 */
  readonly all: ReadonlySet<number>;
  /** 先端のブロック（森の続きに数えない）。 */
  readonly tips: ReadonlySet<number>;
  /** 上の段の左のブロック（木を見分ける）。 */
  readonly upperLeft: ReadonlySet<number>;
}

function row(g: PartGrid | undefined, y: number): (PartCell | null)[] {
  if (!g || g.width < 2 || y >= g.height) return [null, null];
  return [g.cells[y * g.width] ?? null, g.cells[y * g.width + 1] ?? null];
}

/** パーツが重なって並ぶ木か（`Body` が 2×2 で `BodyEdge` があるもの）。 */
export function isTreePart(part: AutoPenPart): boolean {
  const body = part.slots["Body"];
  return part.kind === "repeat" && part.slots["BodyEdge"] !== undefined && body !== undefined && body.width === 2 && body.height === 2;
}

function readBlocks(part: AutoPenPart): TreeBlocks {
  const s = part.slots;
  const upper = row(s["Body"], 0);
  const join = row(s["Body"], 1);
  const pick = (a: (PartCell | null)[], fallback: (PartCell | null)[]) => a.map((c, i) => c ?? fallback[i] ?? null);
  const b = {
    tip: row(s["Top"], 0),
    upper,
    upperEdge: pick(row(s["BodyEdge"], 0), upper),
    upperTip: pick(row(s["BodyTip"], 0), upper),
    join,
    joinEdge: pick(row(s["BodyEdge"], 1), join),
    bottom: row(s["Bottom"], 0),
    bottomEdge: pick(row(s["BottomEdge"], 0), row(s["Bottom"], 0)),
  };
  const all = new Set<number>();
  for (const list of Object.values(b)) for (const c of list) if (c) all.add(c.block);
  const tips = new Set<number>(b.tip.flatMap((c) => (c ? [c.block] : [])));
  const upperLeft = new Set<number>([b.upper[0], b.upperEdge[0], b.upperTip[0]].flatMap((c) => (c ? [c.block] : [])));
  return { ...b, all, tips, upperLeft };
}

/** 木の位置（上の段の左のマス）。 */
type Tree = readonly [number, number];

export class TreeSolver {
  /** 範囲（`cells`）をなぞって木を置く。重ねたマスに書く。 */
  paint(grid: PenOverlay, part: AutoPenPart, cells: readonly (readonly [number, number])[]): void {
    if (cells.length === 0) return;
    const tb = readBlocks(part);
    const box = bounds(cells);
    const existing = this.existing(grid, tb, box.x - 6, box.y - 6, box.w + 12, box.h + 12);
    const added = this.newTrees(grid, cells, existing);
    if (added.length === 0) return;
    const trees = new Map<string, Tree>(existing.map((t) => [cellKey(t[0], t[1]), t]));
    for (const t of added) {
      for (const [k, o] of trees) if (Math.abs(o[0] - t[0]) < 2 && Math.abs(o[1] - t[1]) < 2 && (o[0] !== t[0] || o[1] !== t[1])) trees.delete(k);
      trees.set(cellKey(t[0], t[1]), t);
    }
    const own = new Set<string>();
    for (const [tx, ty] of added) for (let side = 0; side < 2; side++) for (let r = -1; r <= 1; r++) own.add(cellKey(tx + side, ty + r));
    const b = bounds(added.flatMap(([x, y]) => [[x - 1, y - 1] as const, [x + 2, y + 2] as const]));
    this.render(grid, tb, [...trees.values()], b, own);
  }

  /**
   * 木の周りを直す（ほかの物で木を消したあと。#311 の「消すと周りが直る」）。`cells` を描いたマスとして、その周りの木の
   * 端の絵を付け直す。描いたマスに上の段の左がある木は無くなったものとして扱う。
   */
  repair(grid: PenOverlay, part: AutoPenPart, cells: readonly (readonly [number, number])[]): void {
    if (cells.length === 0) return;
    const tb = readBlocks(part);
    const box = bounds(cells);
    const trees = this.existing(grid, tb, box.x - 6, box.y - 6, box.w + 12, box.h + 12);
    if (trees.length === 0) return;
    const painted = new Set(cells.map(([x, y]) => cellKey(x, y)));
    this.render(grid, tb, trees, { x: box.x - 2, y: box.y - 2, w: box.w + 4, h: box.h + 4 }, new Set(), painted);
  }

  /** 範囲の中の木（上の段の左のブロックがあるマス）。 */
  private existing(grid: PenOverlay, tb: TreeBlocks, x0: number, y0: number, w: number, h: number): Tree[] {
    const out: Tree[] = [];
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const b = grid.block(x, y);
        if (b !== null && tb.upperLeft.has(b)) out.push([x, y]);
      }
    }
    return out;
  }

  /** なぞった範囲に置く木（いちばん近い木と区切りをそろえる）。 */
  private newTrees(grid: PenOverlay, cells: readonly (readonly [number, number])[], existing: readonly Tree[]): Tree[] {
    const box = bounds(cells);
    let ax = box.x;
    let ay = box.y;
    let bestD = Infinity;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    for (const [x, y] of existing) {
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) {
        bestD = d;
        ax = x;
        ay = y;
      }
    }
    const align = (v: number, a: number) => v - (((v - a) % 2) + 2) % 2;
    const out = new Map<string, Tree>();
    for (const [x, y] of cells) {
      const tx = align(x, ax);
      const ty = align(y, ay);
      // 上の段と下の段がマップの中に入る木だけ置く
      if (grid.get(tx, ty) === null || grid.get(tx + 1, ty) === null) continue;
      out.set(cellKey(tx, ty), [tx, ty]);
    }
    return [...out.values()];
  }

  /** 木の並びから、範囲のマスのブロックを決めて書く。`own` は必ず書くマス、`skip` は書かないマス。 */
  private render(
    grid: PenOverlay,
    tb: TreeBlocks,
    trees: readonly Tree[],
    box: { x: number; y: number; w: number; h: number },
    own: ReadonlySet<string>,
    skip: ReadonlySet<string> = new Set(),
  ): void {
    const layers = new Map<string, number>();
    const sides = new Map<string, number>();
    const treeSet = new Set(trees.map(([x, y]) => cellKey(x, y)));
    const mark = (x: number, y: number, layer: Layer, side: number) => {
      const k = cellKey(x, y);
      if (skip.has(k)) return;
      layers.set(k, (layers.get(k) ?? 0) | layer);
      sides.set(k, side);
    };
    for (const [tx, ty] of trees) {
      if (skip.has(cellKey(tx, ty))) continue;
      for (let side = 0; side < 2; side++) {
        mark(tx + side, ty - 1, Layer.Tip, side);
        mark(tx + side, ty, Layer.Upper, side);
        mark(tx + side, ty + 1, Layer.Lower, side);
      }
    }
    const solid = (x: number, y: number): boolean => {
      const b = grid.block(x, y);
      if (b === null) return true;
      const l = layers.get(cellKey(x, y));
      if (l !== undefined) return (l & (Layer.Upper | Layer.Lower)) !== 0;
      if (skip.has(cellKey(x, y))) return false;
      return tb.all.has(b) && !tb.tips.has(b) && !(x >= box.x && y >= box.y && x < box.x + box.w && y < box.y + box.h);
    };
    const writes: { x: number; y: number; cell: PartCell }[] = [];
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const k = cellKey(x, y);
        const layer = layers.get(k);
        const cur = grid.block(x, y);
        if (cur === null) continue;
        if (layer === undefined) continue;
        if (!own.has(k) && !tb.all.has(cur)) continue;
        const side = sides.get(k)!;
        const open = !solid(side === 0 ? x - 1 : x + 1, y);
        let cell: PartCell | null;
        if (layer & Layer.Upper) {
          const above = treeSet.has(cellKey(x - side, y - 2)) || grid.get(x - side, y - 2) === null;
          cell = open ? tb.upperEdge[side]! : above ? tb.upper[side]! : tb.upperTip[side]!;
        } else if (layer & Layer.Lower) {
          cell = layer & Layer.Tip ? (open ? tb.joinEdge[side]! : tb.join[side]!) : open ? tb.bottomEdge[side]! : tb.bottom[side]!;
        } else {
          cell = tb.tip[side]!;
        }
        if (cell) writes.push({ x, y, cell });
      }
    }
    for (const { x, y, cell } of writes) grid.set({ x, y, block: cell.block, ...(cell.movement !== null ? { movement: cell.movement } : {}) });
  }
}

function bounds(cells: readonly (readonly [number, number])[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of cells) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
