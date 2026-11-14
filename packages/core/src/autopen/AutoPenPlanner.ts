import { EdgeSolver, hasRing2, slotCellAt } from "./EdgeSolver.js";
import type { PartIndex } from "./PartIndex.js";
import { PenOverlay, dilate, type PenSource, type PenWrite } from "./PenGrid.js";
import { RepeatSolver } from "./RepeatSolver.js";
import { SLOT_BODY, type AutoPenPart } from "./types.js";

/** 筆の大きさ（1・2・3・5 マス）。 */
export const BRUSH_SIZES = [1, 2, 3, 5] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];

/**
 * 筆の範囲（左上と 1 辺）。奇数の筆はカーソルのマスを中心に、偶数の筆はカーソルがマスのどちらの半分にあるかで寄せる
 * （`fx`・`fy` はマスの中の位置 0〜1。0.5 未満なら左・上へ寄せる）。
 */
export function brushRect(x: number, y: number, size: number, fx = 0.5, fy = 0.5): { x: number; y: number; size: number } {
  const half = Math.floor((size - 1) / 2);
  if (size % 2 === 1) return { x: x - half, y: y - half, size };
  return { x: x - half - (fx < 0.5 ? 1 : 0), y: y - half - (fy < 0.5 ? 1 : 0), size };
}

/** 筆の範囲のマス。 */
export function brushCells(rect: { x: number; y: number; size: number }): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = 0; dy < rect.size; dy++) for (let dx = 0; dx < rect.size; dx++) out.push([rect.x + dx, rect.y + dy]);
  return out;
}

/** 2 点を結ぶマス（速く動かして飛んだマスをつなぐ。端を含む）。 */
export function lineCells(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const out: [number, number][] = [];
  let x = ax;
  let y = ay;
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === bx && y === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** 描いたマス（`writes`）と、使ったパーツ。 */
export interface PenPlan {
  readonly part: AutoPenPart;
  readonly writes: PenWrite[];
}

/**
 * 自動ペンの塗り方（#310・#311）。選んだブロックが入っているパーツの種類で塗り方を変える。
 * - 面: 選んだブロックで塗る。部品: 押した所を左上にして本体を 1 回置く（`placePiece`）。
 * - 縁つき: 筆の範囲を `C` で塗ったあと、範囲を 1 マス（2 周目があれば 2 マス）広げて縁を直す。
 * - くり返し: RepeatSolver（#311）。
 * どの塗り方のあとも、広げた範囲の縁つきの縁を直す（ほかの物で岸を消したときも岸が直る）。
 */
export class AutoPenPlanner {
  private readonly edges: EdgeSolver;
  private readonly repeats: RepeatSolver;

  constructor(readonly index: PartIndex) {
    this.edges = new EdgeSolver(index);
    this.repeats = new RepeatSolver(index);
  }

  /** そのブロックで描くパーツ（無ければ null = ふつうの鉛筆）。 */
  partFor(block: number): AutoPenPart | null {
    return this.index.partOf(block);
  }

  /** 縁を直す広さ（どれかの縁つきが 2 周目を持てば 2）。 */
  private fixRadius(part: AutoPenPart | null): number {
    if (part?.kind === "edge") return hasRing2(part) ? 2 : 1;
    return this.index.parts.some((p) => p.kind === "edge" && hasRing2(p)) ? 2 : 1;
  }

  /** 筆で塗る（面・縁つき・くり返し。部品は最初のマスに 1 回置く）。パーツが無ければ null。 */
  stroke(source: PenSource, block: number, cells: readonly (readonly [number, number])[]): PenPlan | null {
    const part = this.index.partOf(block);
    return part ? this.strokeWith(source, part, block, cells) : null;
  }

  /** パーツを決めて筆で塗る（`block` は面で塗るブロック）。 */
  strokeWith(source: PenSource, part: AutoPenPart, block: number, cells: readonly (readonly [number, number])[]): PenPlan | null {
    if (cells.length === 0) return { part, writes: [] };
    if (part.kind === "piece") return this.placePieceOf(source, part, cells[0]![0], cells[0]![1]);
    const grid = new PenOverlay(source);
    if (part.kind === "repeat") {
      this.repeats.paint(grid, part, cells);
    } else if (part.kind === "edge") {
      const c = part.slots["C"];
      for (const [x, y] of cells) {
        const cell = c ? slotCellAt(c, x, y) : null;
        grid.set(cell ? { x, y, block: cell.block, ...(cell.movement !== null ? { movement: cell.movement } : {}) } : { x, y, block });
      }
    } else {
      const m = movementOf(part, block);
      for (const [x, y] of cells) grid.set({ x, y, block, ...(m !== null ? { movement: m } : {}) });
    }
    if (part.kind !== "repeat") this.repeats.repairAround(grid, cells);
    this.fixEdges(grid, cells, part);
    return { part, writes: grid.writes() };
  }

  /** 部品を `x, y` を左上にして置く。 */
  placePiece(source: PenSource, block: number, x: number, y: number): PenPlan | null {
    const part = this.index.partOf(block);
    return part ? this.placePieceOf(source, part, x, y) : null;
  }

  private placePieceOf(source: PenSource, part: AutoPenPart, x: number, y: number): PenPlan | null {
    const body = part.slots[SLOT_BODY];
    if (!body) return null;
    const grid = new PenOverlay(source);
    for (let dy = 0; dy < body.height; dy++) {
      for (let dx = 0; dx < body.width; dx++) {
        const c = body.cells[dy * body.width + dx];
        if (c) grid.set({ x: x + dx, y: y + dy, block: c.block, ...(c.movement !== null ? { movement: c.movement } : {}) });
      }
    }
    return { part, writes: grid.writes() };
  }

  /** 描いたマスの周りの縁つきの縁を直す（重ねたマスに書く）。 */
  private fixEdges(grid: PenOverlay, cells: readonly (readonly [number, number])[], part: AutoPenPart): void {
    if (!this.index.parts.some((p) => p.kind === "edge")) return;
    const region = dilate(cells, this.fixRadius(part));
    const changes = this.edges.solve(grid, region, part.kind === "edge" ? part : null, cells);
    for (const c of changes) grid.set({ x: c.x, y: c.y, block: c.block, ...(c.movement !== null ? { movement: c.movement } : {}) });
  }

  /**
   * 範囲を整える（マップ作成補助 #312）: 範囲の中の縁つきの縁を直す（`edges`）、くり返しの模様をそろえる（`repeats`）。
   */
  tidy(source: PenSource, cells: readonly (readonly [number, number])[], options: { edges: boolean; repeats: boolean }): PenWrite[] {
    const grid = new PenOverlay(source);
    if (options.repeats) this.repeats.tidy(grid, cells);
    if (options.edges && this.index.parts.some((p) => p.kind === "edge")) {
      for (const c of this.edges.solve(grid, cells)) grid.set({ x: c.x, y: c.y, block: c.block, ...(c.movement !== null ? { movement: c.movement } : {}) });
    }
    return grid.writes();
  }

  /** 範囲をパーツで塗る（マップ作成補助の「選んだパーツで範囲を塗る」）。 */
  fillWith(source: PenSource, part: AutoPenPart, cells: readonly (readonly [number, number])[]): PenWrite[] {
    const first = firstBlock(part);
    if (first === null || cells.length === 0) return [];
    return this.strokeWith(source, part, first, cells)?.writes ?? [];
  }
}

/** パーツの中でのそのブロックの移動許可（決めていなければ null）。 */
function movementOf(part: AutoPenPart, block: number): number | null {
  for (const g of Object.values(part.slots)) for (const c of g.cells) if (c && c.block === block && c.movement !== null) return c.movement;
  return null;
}

/** パーツの塗り方に使う最初のブロック（縁つきは C、くり返しは Body、ほかは最初の枠の最初のマス）。 */
export function firstBlock(part: AutoPenPart): number | null {
  const order = part.kind === "edge" ? ["C"] : part.kind === "repeat" ? ["Body"] : Object.keys(part.slots);
  for (const name of [...order, ...Object.keys(part.slots)]) {
    const c = part.slots[name]?.cells.find((x) => x !== null);
    if (c) return c.block;
  }
  return null;
}
