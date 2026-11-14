import type { PartIndex } from "./PartIndex.js";
import { cellKey, mod, type PenOverlay } from "./PenGrid.js";
import { EDGE_RING2_SLOTS, type AutoPenPart, type PartGrid } from "./types.js";

/**
 * 縁つき（9 マスの枠。HMA の 9 グリッドに当たる）の縁を、周りに合わせて選び直す（#310）。
 *
 * 1. 縁つきのブロックのマスを上下左右のつながりでまとめ、辺と角のブロックの多数決でどのパーツかを決める
 *    （描いたマスを含むまとまりは、描いたパーツにする）。
 * 2. マスごとに上下左右と斜めが同じまとまりかを見て枠を選ぶ。マップの外は同じとみなす。
 *    - 上下か左右の両方が外なら、細い所として変えない。
 *    - 上が外なら、左も外で `NW`、右も外で `NE`、どちらでもなければ `N`（下・左・右も同じ）。
 *    - 4 方向とも中なら、斜めが外の向きで内角（`INW` など）、斜めも全部中なら `C`。
 * 3. 2 周目を持つパーツは、`C` になったマスだけを中身として同じ判定をもう一度行い、`2N` などを選ぶ。
 * 4. 今のブロックがすでに同じ枠に入っていれば変えない（元の岸の絵柄を残す）。枠が無い・空きのマスも変えない。
 * 全部のマスを決めてから書く（決めている途中の値は判定に使わない）。
 */

/** 1 周目の枠（`thin` は細い所として変えないマス）。 */
type Slot = string | "thin";

/** 上下左右と斜めが同じか（順に 上 下 左 右 左上 右上 左下 右下）。 */
interface Around {
  readonly n: boolean;
  readonly s: boolean;
  readonly w: boolean;
  readonly e: boolean;
  readonly nw: boolean;
  readonly ne: boolean;
  readonly sw: boolean;
  readonly se: boolean;
}

/** 周りから枠の名前を選ぶ（前に `2` を付けると 2 周目）。 */
export function edgeSlotOf(a: Around): Slot {
  if ((!a.n && !a.s) || (!a.w && !a.e)) return "thin";
  if (!a.n) return !a.w ? "NW" : !a.e ? "NE" : "N";
  if (!a.s) return !a.w ? "SW" : !a.e ? "SE" : "S";
  if (!a.w) return "W";
  if (!a.e) return "E";
  if (!a.nw) return "INW";
  if (!a.ne) return "INE";
  if (!a.sw) return "ISW";
  if (!a.se) return "ISE";
  return "C";
}

/** パーツが 2 周目を持つか。 */
export function hasRing2(part: AutoPenPart): boolean {
  return EDGE_RING2_SLOTS.some((s) => part.slots[s] !== undefined);
}

/** 枠のマップの座標 (x, y) に当たるマス（枠が大きければマップの座標でそろえてくり返す）。 */
export function slotCellAt(grid: PartGrid, x: number, y: number): PartGrid["cells"][number] {
  return grid.cells[mod(y, grid.height) * grid.width + mod(x, grid.width)] ?? null;
}

/** 解いた結果のマス 1 つ。 */
export interface EdgeChange {
  readonly x: number;
  readonly y: number;
  readonly block: number;
  readonly movement: number | null;
  readonly part: AutoPenPart;
  readonly slot: string;
}

export class EdgeSolver {
  constructor(private readonly index: PartIndex) {}

  /** そのブロックを持つ縁つきのパーツ。 */
  private edgeParts(block: number | null): AutoPenPart[] {
    if (block === null) return [];
    const out: AutoPenPart[] = [];
    for (const p of this.index.all(block)) if (p.part.kind === "edge" && !out.includes(p.part)) out.push(p.part);
    return out;
  }

  /**
   * `region` のマスの縁を直す。`grid` は書く予定を重ねたもの（描いたマスを先に `C` にしておく）。
   * `seeds` は描いたマス（それを含むまとまりは `prefer` のパーツにする）。戻り値は変えるマス。
   */
  solve(grid: PenOverlay, region: readonly (readonly [number, number])[], prefer: AutoPenPart | null = null, seeds: readonly (readonly [number, number])[] = []): EdgeChange[] {
    if (region.length === 0) return [];
    // まとまりを見る範囲（直すマスから 3 マス。2 周目の判定に 1 周目の結果が 1 マス外まで要る）
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of region) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const M = 3;
    const x0 = minX - M;
    const y0 = minY - M;
    const W = maxX - minX + 1 + 2 * M;
    const H = maxY - minY + 1 + 2 * M;
    const at = (x: number, y: number) => (y - y0) * W + (x - x0);
    const inWin = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + W && y < y0 + H;

    // 1. まとまり（窓の中だけ）
    const comp = new Int32Array(W * H).fill(-1);
    const compPart: (AutoPenPart | null)[] = [];
    const seedSet = new Set(seeds.map(([x, y]) => cellKey(x, y)));
    for (let y = y0; y < y0 + H; y++) {
      for (let x = x0; x < x0 + W; x++) {
        if (comp[at(x, y)] !== -1 || this.edgeParts(grid.block(x, y)).length === 0) continue;
        const id = compPart.length;
        const stack: [number, number][] = [[x, y]];
        comp[at(x, y)] = id;
        const votes = new Map<AutoPenPart, number>();
        const centers = new Map<AutoPenPart, number>();
        let seeded = false;
        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          if (seedSet.has(cellKey(cx, cy))) seeded = true;
          const b = grid.block(cx, cy)!;
          for (const part of this.edgeParts(b)) {
            const slots = this.index.slotsIn(part, b);
            const target = slots.some((s) => s !== "C") ? votes : centers;
            target.set(part, (target.get(part) ?? 0) + 1);
          }
          for (const [dx, dy] of [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
          ] as const) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!inWin(nx, ny) || comp[at(nx, ny)] !== -1 || this.edgeParts(grid.block(nx, ny)).length === 0) continue;
            comp[at(nx, ny)] = id;
            stack.push([nx, ny]);
          }
        }
        compPart.push(seeded && prefer ? prefer : best(votes.size > 0 ? votes : centers));
      }
    }
    // そのマスのパーツ（まとまりのパーツで、ブロックがそのパーツにあるとき）
    const partAt = (x: number, y: number): AutoPenPart | null => {
      if (!inWin(x, y)) return null;
      const c = comp[at(x, y)]!;
      if (c < 0) return null;
      const part = compPart[c]!;
      return part && this.edgeParts(grid.block(x, y)).includes(part) ? part : null;
    };
    // 同じか（マップの外は同じ。窓の外は今のブロックがそのパーツにあるかで見る）
    const same = (x: number, y: number, part: AutoPenPart): boolean => {
      const b = grid.block(x, y);
      if (b === null) return true;
      if (!inWin(x, y)) return this.edgeParts(b).includes(part);
      return partAt(x, y) === part;
    };
    const around = (x: number, y: number, eq: (x: number, y: number) => boolean): Around => ({
      n: eq(x, y - 1),
      s: eq(x, y + 1),
      w: eq(x - 1, y),
      e: eq(x + 1, y),
      nw: eq(x - 1, y - 1),
      ne: eq(x + 1, y - 1),
      sw: eq(x - 1, y + 1),
      se: eq(x + 1, y + 1),
    });

    // 2. 1 周目の枠（2 周目の判定のため、直すマスより 1 マス外まで）
    const ring1 = new Map<string, Slot>();
    const ring1At = (x: number, y: number, part: AutoPenPart): Slot | null => {
      const k = cellKey(x, y);
      if (ring1.has(k)) return ring1.get(k)!;
      if (partAt(x, y) !== part) return null;
      const s = edgeSlotOf(around(x, y, (ax, ay) => same(ax, ay, part)));
      ring1.set(k, s);
      return s;
    };

    // 3. 直すマスの枠を決める
    const out: EdgeChange[] = [];
    for (const [x, y] of region) {
      const part = partAt(x, y);
      if (!part) continue;
      let slot = ring1At(x, y, part);
      if (slot === null || slot === "thin") continue;
      if (slot === "C" && hasRing2(part)) {
        const inner = (ax: number, ay: number): boolean => {
          if (grid.block(ax, ay) === null) return true;
          return ring1At(ax, ay, part) === "C";
        };
        const s2 = edgeSlotOf(around(x, y, inner));
        if (s2 !== "thin" && s2 !== "C") slot = `2${s2}`;
      }
      const cur = grid.block(x, y)!;
      if (this.index.slotsIn(part, cur).includes(slot)) continue;
      const g = part.slots[slot];
      if (!g) continue;
      const cell = slotCellAt(g, x, y);
      if (!cell) continue;
      if (cell.block === cur) continue;
      out.push({ x, y, block: cell.block, movement: cell.movement, part, slot });
    }
    return out;
  }
}

/** いちばん票の多いパーツ（同じなら先のもの。票が無ければ null）。 */
function best(votes: Map<AutoPenPart, number>): AutoPenPart | null {
  let out: AutoPenPart | null = null;
  let n = 0;
  for (const [p, v] of votes) {
    if (v > n) {
      out = p;
      n = v;
    }
  }
  return out;
}
