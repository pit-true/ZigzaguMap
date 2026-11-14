import type { PartIndex } from "./PartIndex.js";
import { cellKey, mod, type PenOverlay } from "./PenGrid.js";
import { TreeSolver, isTreePart } from "./TreeSolver.js";
import { SLOT_BODY, SLOT_BOTTOM, SLOT_TOP, type AutoPenPart, type PartCell, type PartGrid } from "./types.js";

/** 「範囲を整える」で、ずらしたほうがこれだけ多く合うときだけ直す（#312）。 */
export const TIDY_MIN_GAIN = 5;

/**
 * くり返し（森・地面の模様など。#311）。
 * - 筆の範囲をくり返しの単位（`Body` の幅 × 高さ）の区切りまで広げ、マップの座標でそろえて `Body` を並べる。
 * - 上下に続く長さを列ごとに数え、上の端の行に `Top`、下の端の行に `Bottom` を付け直す（無ければ `Body` のまま）。
 * - 重なって並ぶ木（`BodyEdge` を持つもの）は TreeSolver。
 */
export class RepeatSolver {
  private readonly trees = new TreeSolver();

  constructor(private readonly index: PartIndex) {}

  /** そのブロックがこのパーツ（くり返し）の枠にあるか。 */
  private inPart(part: AutoPenPart, block: number | null): boolean {
    return block !== null && this.index.slotsIn(part, block).length > 0;
  }

  /** 筆で塗る。 */
  paint(grid: PenOverlay, part: AutoPenPart, cells: readonly (readonly [number, number])[]): void {
    if (isTreePart(part)) return this.trees.paint(grid, part, cells);
    const body = part.slots[SLOT_BODY];
    if (!body) return;
    // 単位の区切りまで広げる
    const units = new Map<string, readonly [number, number]>();
    for (const [x, y] of cells) {
      const ux = x - mod(x, body.width);
      const uy = y - mod(y, body.height);
      units.set(cellKey(ux, uy), [ux, uy]);
    }
    const painted: [number, number][] = [];
    for (const [ux, uy] of units.values()) {
      for (let dy = 0; dy < body.height; dy++) {
        for (let dx = 0; dx < body.width; dx++) {
          const x = ux + dx;
          const y = uy + dy;
          if (grid.get(x, y) === null) continue;
          const c = body.cells[dy * body.width + dx];
          if (c) set(grid, x, y, c);
          painted.push([x, y]);
        }
      }
    }
    this.fixEnds(grid, part, painted);
  }

  /** 描いたマスの列で、上下の端の行に Top・Bottom を付け直す。 */
  private fixEnds(grid: PenOverlay, part: AutoPenPart, cells: readonly (readonly [number, number])[]): void {
    const body = part.slots[SLOT_BODY]!;
    const top = part.slots[SLOT_TOP];
    const bottom = part.slots[SLOT_BOTTOM];
    if (!top && !bottom) return;
    const columns = new Map<number, { min: number; max: number }>();
    for (const [x, y] of cells) {
      const c = columns.get(x);
      if (!c) columns.set(x, { min: y, max: y });
      else {
        c.min = Math.min(c.min, y);
        c.max = Math.max(c.max, y);
      }
    }
    const th = top?.height ?? 0;
    const bh = bottom?.height ?? 0;
    for (const [x, span] of columns) {
      // 描いた所を含む、上下に続く列を探す（端の行の分だけ外まで見る）
      let y0 = span.min;
      while (this.inPart(part, grid.block(x, y0 - 1))) y0--;
      let y1 = span.max;
      while (this.inPart(part, grid.block(x, y1 + 1))) y1++;
      const len = y1 - y0 + 1;
      const atTop = grid.get(x, y0 - 1) !== null;
      const atBottom = grid.get(x, y1 + 1) !== null;
      for (let y = y0; y <= y1; y++) {
        let cell: PartCell | null = null;
        const fromTop = y - y0;
        const fromBottom = y1 - y;
        if (top && atTop && fromTop < th && len > th) cell = gridAt(top, x, fromTop);
        else if (bottom && atBottom && fromBottom < bh && len > th + bh - 1) cell = gridAt(bottom, x, bh - 1 - fromBottom);
        else cell = gridAt(body, x, mod(y, body.height));
        if (cell) set(grid, x, y, cell);
      }
    }
  }

  /** 木を消したあと（ほかの物で描いたあと）に、周りの木の端を付け直す。 */
  repairAround(grid: PenOverlay, cells: readonly (readonly [number, number])[]): void {
    for (const part of this.index.parts) if (isTreePart(part)) this.trees.repair(grid, part, cells);
  }

  /**
   * 範囲を整える（#312）: くり返しのパーツごとに、範囲の中のそのパーツの `Body` のマスで、模様がいちばん合うずらし方を探し、
   * 今のそろえ方（マップの座標）より `TIDY_MIN_GAIN` 点以上よくなるときだけ、そのずらし方で並べ直す。
   */
  tidy(grid: PenOverlay, cells: readonly (readonly [number, number])[]): void {
    for (const part of this.index.parts) {
      if (part.kind !== "repeat" || isTreePart(part)) continue;
      const body = part.slots[SLOT_BODY];
      if (!body) continue;
      const own = cells.filter(([x, y]) => {
        const b = grid.block(x, y);
        return b !== null && this.index.slotsIn(part, b).includes(SLOT_BODY);
      });
      if (own.length === 0) continue;
      const score = (ox: number, oy: number) => {
        let n = 0;
        for (const [x, y] of own) if (gridAt(body, x + ox, mod(y + oy, body.height))?.block === grid.block(x, y)) n++;
        return n;
      };
      const now = score(0, 0);
      let best = { ox: 0, oy: 0, n: now };
      for (let oy = 0; oy < body.height; oy++) {
        for (let ox = 0; ox < body.width; ox++) {
          const n = score(ox, oy);
          if (n > best.n) best = { ox, oy, n };
        }
      }
      if (best.n - now < TIDY_MIN_GAIN) continue;
      for (const [x, y] of own) {
        const c = gridAt(body, x + best.ox, mod(y + best.oy, body.height));
        if (c && c.block !== grid.block(x, y)) set(grid, x, y, c);
      }
    }
  }
}

/** 枠の (x mod 幅, 行) のマス。 */
function gridAt(g: PartGrid, x: number, rowIndex: number): PartCell | null {
  return g.cells[Math.min(rowIndex, g.height - 1) * g.width + mod(x, g.width)] ?? null;
}

function set(grid: PenOverlay, x: number, y: number, c: PartCell): void {
  grid.set({ x, y, block: c.block, ...(c.movement !== null ? { movement: c.movement } : {}) });
}
