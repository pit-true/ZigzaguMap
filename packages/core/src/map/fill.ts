/**
 * 塗りつぶしとマジック塗り（Phase5 #388。Porymap の Bucket Fill と、その Ctrl＋クリック）。DOM に依存しない。
 *
 * - 塗りつぶし: 押したマスから上下左右につながった「同じ」マスを集める。
 * - マジック塗り: つながっていなくても、マップの中の「同じ」マスを全部集める。
 * - 「同じ」の見方（Q2 の推奨）: マップタブはブロックだけ（`block`）、移動エリアタブは移動許可だけ（`movement`）。
 * 範囲は 1 枚のマップの中だけ（隣のマップへは広げない）。集めたマスを選択の柄で埋めるのは `patternCells`。
 */

/** 塗る範囲を調べる格子（`BlockGrid` がそのまま渡せる）。 */
export interface FillSource {
  readonly width: number;
  readonly height: number;
  getBlock(x: number, y: number): number;
  getMovement(x: number, y: number): number;
}

/** 「同じ」とみなすもの。 */
export type FillMatch = "block" | "movement";

/** マスの座標。 */
export interface FillPoint {
  readonly x: number;
  readonly y: number;
}

function keyOf(grid: FillSource, match: FillMatch): (x: number, y: number) => number {
  return match === "block" ? (x, y) => grid.getBlock(x, y) : (x, y) => grid.getMovement(x, y);
}

/**
 * 押したマス `(sx, sy)` から上下左右につながった同じマス（押したマスを含む。左上から行ごとの順）。
 * 押したマスがマップの外なら空。
 */
export function floodRegion(grid: FillSource, sx: number, sy: number, match: FillMatch): FillPoint[] {
  const { width: w, height: h } = grid;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return [];
  const value = keyOf(grid, match);
  const target = value(sx, sy);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [sy * w + sx];
  seen[sy * w + sx] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    const next = (nx: number, ny: number): void => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const j = ny * w + nx;
      if (seen[j] || value(nx, ny) !== target) return;
      seen[j] = 1;
      stack.push(j);
    };
    next(x, y - 1);
    next(x, y + 1);
    next(x - 1, y);
    next(x + 1, y);
  }
  return collect(seen, w, h);
}

/** マップの中で、`(sx, sy)` と同じマスの全部（つながっていなくてよい。左上から行ごとの順）。 */
export function matchingCells(grid: FillSource, sx: number, sy: number, match: FillMatch): FillPoint[] {
  const { width: w, height: h } = grid;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return [];
  const value = keyOf(grid, match);
  const target = value(sx, sy);
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (value(x, y) === target) seen[y * w + x] = 1;
  return collect(seen, w, h);
}

function collect(seen: Uint8Array, w: number, h: number): FillPoint[] {
  const out: FillPoint[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (seen[y * w + x]) out.push({ x, y });
  return out;
}

/** 埋める柄（選択。`blocks` は左上から横へ。`holes` が true のマスは書かない）。 */
export interface FillPattern {
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly number[];
  readonly movements?: readonly number[];
  readonly holes?: readonly boolean[];
}

/** 柄で埋めたマス 1 つ（`movement` は柄が移動許可を持つときだけ）。 */
export interface PatternCell {
  readonly x: number;
  readonly y: number;
  readonly block: number;
  readonly movement?: number;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * 集めたマスを柄で埋める。柄（スタンプ）は `origin`（押したマス）を左上にしてくり返す（矩形塗りと同じく柄の格子に揃える）。
 * 柄の穴に当たるマスは書かない。
 */
export function patternCells(cells: readonly FillPoint[], origin: FillPoint, pattern: FillPattern): PatternCell[] {
  const out: PatternCell[] = [];
  for (const c of cells) {
    const i = mod(c.y - origin.y, pattern.height) * pattern.width + mod(c.x - origin.x, pattern.width);
    if (pattern.holes?.[i] === true) continue;
    const block = pattern.blocks[i] ?? 0;
    const movement = pattern.movements?.[i];
    out.push(movement === undefined ? { x: c.x, y: c.y, block } : { x: c.x, y: c.y, block, movement });
  }
  return out;
}
