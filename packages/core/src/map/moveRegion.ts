/**
 * 範囲を選んで動かす（Phase7 #516。Q8 の推奨）。DOM に依存しない。
 * 矩形の中のマス（ブロックと移動許可）を、マップの中で `dx`・`dy` だけ動かす。動かした先がマップからはみ出ないよう、ずらす量を端で止める。
 * 動かした跡（新しい位置に重ならない所）は、呼ぶ側が決めたもの（今選んでいるブロック）で埋める。
 */

/** マスの矩形。 */
export interface RegionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 1 マスに書くもの。 */
export interface RegionCell {
  readonly x: number;
  readonly y: number;
  readonly block: number;
  readonly movement: number;
}

/** 跡を埋めるもの（そのマスに書くブロックと移動許可。null ならそのマスは書かない）。 */
export type RegionFill = (x: number, y: number) => { readonly block: number; readonly movement: number } | null;

/** 矩形をマップの中に収める（はみ出た分を切る。幅か高さが 0 になれば null）。 */
export function clipRegion(rect: RegionRect, mapWidth: number, mapHeight: number): RegionRect | null {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(mapWidth, rect.x + rect.width);
  const y1 = Math.min(mapHeight, rect.y + rect.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** 動かした先がマップの中に収まるよう、ずらす量を端で止める。 */
export function clampRegionMove(rect: RegionRect, dx: number, dy: number, mapWidth: number, mapHeight: number): { dx: number; dy: number } {
  const cx = Math.min(Math.max(dx, -rect.x), mapWidth - rect.x - rect.width);
  const cy = Math.min(Math.max(dy, -rect.y), mapHeight - rect.y - rect.height);
  // -0 にしない
  return { dx: cx || 0, dy: cy || 0 };
}

/**
 * 3 層のブロックを右端で切るときに 1 マス広げる（今の矩形の選択と同じ。#300）。右端の列に 3 層のブロック N があり、
 * その右のマスが次の番号 N+1 なら、右へ 1 マス広げる（マップの外へは広げない）。`read` はマスの値（下位 10 ビットがブロック）。
 */
export function widenForTriple(
  rect: RegionRect,
  read: (x: number, y: number) => number,
  isTriple: (block: number) => boolean,
  mapWidth: number,
): RegionRect {
  const right = rect.x + rect.width;
  if (right >= mapWidth) return rect;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const b = read(right - 1, y) & 0x3ff;
    if (isTriple(b) && (read(right, y) & 0x3ff) === b + 1) return { ...rect, width: rect.width + 1 };
  }
  return rect;
}

/**
 * 動かすときに書くマスの一覧。動かした先には元のマスの値（ブロックと移動許可）を、跡には `fill` の値を書く。
 * 動かす量は `clampRegionMove` で止めたものを渡す（ここでは止めない）。量が 0 なら空。`read` はマスの値（移動許可は上位 6 ビット）。
 * 並びは、動かした先（上の行から）→ 跡（上の行から）。
 */
export function planRegionMove(read: (x: number, y: number) => number, rect: RegionRect, dx: number, dy: number, fill: RegionFill): RegionCell[] {
  if (dx === 0 && dy === 0) return [];
  const out: RegionCell[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const v = read(x, y);
      out.push({ x: x + dx, y: y + dy, block: v & 0x3ff, movement: (v >>> 10) & 0x3f });
    }
  }
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const inside = x >= rect.x + dx && x < rect.x + dx + rect.width && y >= rect.y + dy && y < rect.y + dy + rect.height;
      if (inside) continue;
      const f = fill(x, y);
      if (f) out.push({ x, y, block: f.block, movement: f.movement });
    }
  }
  return out;
}
