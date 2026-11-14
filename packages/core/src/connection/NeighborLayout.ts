import type { MapId } from "../map/types.js";
import { ConnectionDirection } from "./layout.js";
import type { MapConnection } from "./types.js";

/** マス単位の矩形。 */
export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 大きさ（マス）。 */
export interface MapSize {
  readonly width: number;
  readonly height: number;
}

/** 上下左右の辺。 */
export type Side = "up" | "down" | "left" | "right";

/** 主マップのまわりに広げる幅（マス）。 */
export interface Margins {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** 隣のマップ 1 枚の置き場所。座標はどれも主マップの左上を (0, 0) としたマス。 */
export interface NeighborPlacement {
  /** 主マップの接続の番号。 */
  readonly index: number;
  /** 接続の向き（1 下、2 上、3 左、4 右）。 */
  readonly direction: number;
  readonly side: Side;
  readonly id: MapId;
  readonly offset: number;
  /** 隣のマップ全体の置き場所。 */
  readonly placement: CellRect;
  /** 見せる部分（隣のマップの中の座標）。 */
  readonly band: CellRect;
  /** 見せる部分の画面上の置き場所（主マップの左上が原点）。 */
  readonly bandAt: CellRect;
}

/** 隣のマップの並べ方の結果。 */
export interface NeighborLayoutResult {
  readonly neighbors: NeighborPlacement[];
  /** 主マップのまわりに要る余白（帯の分）。 */
  readonly margins: Margins;
  /** 接続のある辺（その辺は境界ブロックを描かない）。 */
  readonly connectedSides: Side[];
}

/** 見せる範囲（null = マップ全体）。 */
export type NeighborRange = number | null;

/** 向きから辺の名前（上下左右でなければ null）。 */
export function sideOf(direction: number): Side | null {
  switch (direction) {
    case ConnectionDirection.Down:
      return "down";
    case ConnectionDirection.Up:
      return "up";
    case ConnectionDirection.Left:
      return "left";
    case ConnectionDirection.Right:
      return "right";
    default:
      return null;
  }
}

/** 逆向き（下⇔上、左⇔右、ダイブ⇔浮上）。無しは 0。 */
export function oppositeDirection(direction: number): number {
  switch (direction) {
    case ConnectionDirection.Down:
      return ConnectionDirection.Up;
    case ConnectionDirection.Up:
      return ConnectionDirection.Down;
    case ConnectionDirection.Left:
      return ConnectionDirection.Right;
    case ConnectionDirection.Right:
      return ConnectionDirection.Left;
    case ConnectionDirection.Dive:
      return ConnectionDirection.Emerge;
    case ConnectionDirection.Emerge:
      return ConnectionDirection.Dive;
    default:
      return ConnectionDirection.None;
  }
}

/** 上下の接続か（offset が横のずれ）。 */
export function isVertical(direction: number): boolean {
  return direction === ConnectionDirection.Up || direction === ConnectionDirection.Down;
}

/**
 * 相手のマップの接続のうち、`from` を指す逆向きの接続の番号（無ければ null）。
 * 同じ向きで `from` を指すものが複数あれば、ずれが `-offset` のものを先に選ぶ。
 */
export function inverseOf(connections: readonly MapConnection[] | null | undefined, from: MapId, direction: number, offset?: number): number | null {
  const want = oppositeDirection(direction);
  let found: number | null = null;
  (connections ?? []).forEach((c, i) => {
    if (c.direction !== want || c.bank !== from.bank || c.map !== from.map) return;
    if (found === null || (offset !== undefined && c.offset === -offset)) found = i;
  });
  return found;
}

/** 隣のマップ全体の置き場所（主マップの左上が原点）。上下左右でなければ null。 */
export function placeNeighbor(main: MapSize, direction: number, offset: number, size: MapSize): CellRect | null {
  switch (direction) {
    case ConnectionDirection.Down:
      return { x: offset, y: main.height, width: size.width, height: size.height };
    case ConnectionDirection.Up:
      return { x: offset, y: -size.height, width: size.width, height: size.height };
    case ConnectionDirection.Left:
      return { x: -size.width, y: offset, width: size.width, height: size.height };
    case ConnectionDirection.Right:
      return { x: main.width, y: offset, width: size.width, height: size.height };
    default:
      return null;
  }
}

function intersect(a: CellRect, b: CellRect): CellRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return r > x && bottom > y ? { x, y, width: r - x, height: bottom - y } : null;
}

/**
 * 主マップの接続から、隣のマップの置き場所と見せる部分を求める。
 * - 上下左右だけを並べる（ダイブ・浮上は重ねて見せる別の機能で扱う）。
 * - `range` がマス数なら、主マップを `range` マス広げた矩形の中だけを見せる（境界から `range` マスの帯）。null ならマップ全体。
 * - 大きさの分からない（読めない）相手は並べない。
 */
export function layoutNeighbors(
  main: MapSize & { readonly connections: readonly MapConnection[] | null | undefined },
  sizeOf: (id: MapId) => MapSize | null,
  range: NeighborRange,
): NeighborLayoutResult {
  const neighbors: NeighborPlacement[] = [];
  const sides = new Set<Side>();
  const view: CellRect | null = range === null ? null : { x: -range, y: -range, width: main.width + 2 * range, height: main.height + 2 * range };
  (main.connections ?? []).forEach((c, index) => {
    const side = sideOf(c.direction);
    if (!side) return;
    const id = { bank: c.bank, map: c.map };
    const size = sizeOf(id);
    if (!size || size.width <= 0 || size.height <= 0) return;
    const placement = placeNeighbor(main, c.direction, c.offset, size)!;
    const bandAt = view ? intersect(placement, view) : placement;
    if (!bandAt) return;
    sides.add(side);
    neighbors.push({
      index,
      direction: c.direction,
      side,
      id,
      offset: c.offset,
      placement,
      band: { x: bandAt.x - placement.x, y: bandAt.y - placement.y, width: bandAt.width, height: bandAt.height },
      bandAt,
    });
  });
  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  for (const n of neighbors) {
    const r = n.bandAt;
    left = Math.max(left, -r.x);
    top = Math.max(top, -r.y);
    right = Math.max(right, r.x + r.width - main.width);
    bottom = Math.max(bottom, r.y + r.height - main.height);
  }
  return { neighbors, margins: { left, top, right, bottom }, connectedSides: [...sides] };
}

/**
 * 画面上のマス（主マップの左上が原点。外もありうる）が、どのマップのどのマスかを返す。
 * 主マップの中なら主マップ。隣の見せている部分の中なら、そのマップ（後に並べたものが上）。どこでもなければ null。
 */
export function resolveCell(
  layout: NeighborLayoutResult,
  main: MapSize & { readonly id: MapId },
  x: number,
  y: number,
): { id: MapId; x: number; y: number; neighbor: NeighborPlacement | null } | null {
  if (x >= 0 && y >= 0 && x < main.width && y < main.height) return { id: main.id, x, y, neighbor: null };
  for (let i = layout.neighbors.length - 1; i >= 0; i--) {
    const n = layout.neighbors[i]!;
    const r = n.bandAt;
    if (x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height) return { id: n.id, x: x - n.placement.x, y: y - n.placement.y, neighbor: n };
  }
  return null;
}
