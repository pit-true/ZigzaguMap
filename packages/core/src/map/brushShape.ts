/**
 * ブラシの大きさと形（Phase7 #515。Q7 の推奨）。鉛筆で 1 ブロック（か移動許可 1 つ）を選んでいるときに、N×N のマスへ描く。
 * DOM に依存しない。
 * - 大きさは 1〜9。範囲はカーソルのマスを真ん中にする。偶数の大きさは真ん中が 2 マスになるので、左上へ寄せる
 *   （大きさ 2 ならカーソルのマスとその左・上・左上。範囲は -floor(n/2) から n-1-floor(n/2) まで）。
 * - 形は正方形と円。円は、範囲の真ん中からマスの真ん中までの距離が n/2 - 1/4 以下のマス（大きさ 3 で十字、5 で角を落とした形）。
 * ミキシングバッグの重みつきの選び方（`pickWeighted`）もここに置く。
 */

/** ブラシの形。 */
export type BrushShape = "square" | "circle";

/** 大きさの下限と上限。 */
export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 9;

/** ブラシのマス（カーソルのマスからのずれ）。 */
export interface BrushOffset {
  readonly dx: number;
  readonly dy: number;
}

/** 個人設定などの値を大きさにする（整数にして 1〜9 に収める。読めなければ 1）。 */
export function clampBrushSize(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : MIN_BRUSH_SIZE;
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, n));
}

/** 個人設定などの値を形にする（知らない値は正方形）。 */
export function toBrushShape(value: unknown): BrushShape {
  return value === "circle" ? "circle" : "square";
}

/** 範囲の左上のずれ（カーソルのマスから。大きさ 1 なら 0）。 */
export function brushStart(size: number): number {
  // 大きさ 1 で -0 にしない
  return -Math.floor(clampBrushSize(size) / 2) || 0;
}

const cache = new Map<string, readonly BrushOffset[]>();

/** 形のマス（カーソルのマスからのずれ。上の行から順に、行の中は左から）。 */
export function brushOffsets(size: number, shape: BrushShape): readonly BrushOffset[] {
  const n = clampBrushSize(size);
  const key = `${n}:${shape}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const start = brushStart(n);
  const center = start + (n - 1) / 2;
  const r = n / 2 - 0.25;
  const out: BrushOffset[] = [];
  for (let dy = start; dy < start + n; dy++) {
    for (let dx = start; dx < start + n; dx++) {
      if (shape === "circle" && (dx - center) ** 2 + (dy - center) ** 2 > r * r) continue;
      out.push({ dx, dy });
    }
  }
  cache.set(key, out);
  return out;
}

/** カーソルのマス `(x, y)` に置いたときのマス。 */
export function brushShapeCells(x: number, y: number, size: number, shape: BrushShape): { x: number; y: number }[] {
  return brushOffsets(size, shape).map((o) => ({ x: x + o.dx, y: y + o.dy }));
}

/**
 * 重みつきで 1 つ選ぶ（選んだ番号を返す）。`r` は 0 以上 1 未満の乱数。重みは 1 以上の整数として扱う（読めない値は 1）。
 * 重みが全部 1 なら `Math.floor(r * 数)` と同じ番号になる（重みを付ける前と同じ並び）。空なら -1。
 */
export function pickWeighted(weights: readonly number[], r: number): number {
  if (weights.length === 0) return -1;
  const w = weights.map((v) => (Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1));
  const total = w.reduce((a, b) => a + b, 0);
  let t = Math.floor(r * total);
  for (let i = 0; i < w.length; i++) {
    t -= w[i]!;
    if (t < 0) return i;
  }
  return w.length - 1;
}
