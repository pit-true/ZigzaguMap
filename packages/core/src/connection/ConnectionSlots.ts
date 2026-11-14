import type { MapId } from "../map/types.js";
import { MAP_SIZE_LIMIT } from "../command/commands/layout/mapSize.js";
import { ConnectionDirection } from "./layout.js";
import { isVertical, type MapSize, type Side } from "./NeighborLayout.js";
import type { MapConnection } from "./types.js";

/** つなげる区間のいちばん短い長さ（マス。HMA と同じ 4）。 */
export const MIN_SLOT = 4;
/** 接続から作る新しいマップの奥行き（辺と直交する向きの長さ。マス）。 */
export const NEW_CONNECTED_MAP_DEPTH = 20;
/** 接続から作る新しいマップの配置（ブロック 0・移動許可 0x0C = 通れる）。 */
export const NEW_CONNECTED_MAP_CELL = 0x0c << 10;

/** 辺の上の区間（辺に沿った位置。上下の辺なら x、左右の辺なら y）。 */
export interface Slot {
  readonly start: number;
  readonly length: number;
}

/** 辺の向きの接続の番号（上 2・下 1・左 3・右 4）。 */
export function directionOf(side: Side): number {
  return side === "up" ? ConnectionDirection.Up : side === "down" ? ConnectionDirection.Down : side === "left" ? ConnectionDirection.Left : ConnectionDirection.Right;
}

/** 辺の長さ（上下なら幅、左右なら高さ）。 */
export function edgeLength(main: MapSize, side: Side): number {
  return side === "up" || side === "down" ? main.width : main.height;
}

/**
 * 辺のうち、同じ向きの既存の接続が覆っていない区間を返す（辺の上の順）。
 * 既存の接続は、相手のマップの辺に沿った長さだけ覆う（大きさの分からない相手は 1 マスとみなす）。
 */
export function freeSlots(
  main: MapSize & { readonly connections: readonly MapConnection[] | null | undefined },
  side: Side,
  sizeOf: (id: MapId) => MapSize | null,
): Slot[] {
  const direction = directionOf(side);
  const length = edgeLength(main, side);
  const covered: [number, number][] = [];
  for (const c of main.connections ?? []) {
    if (c.direction !== direction) continue;
    const size = sizeOf({ bank: c.bank, map: c.map });
    const along = size ? (isVertical(direction) ? size.width : size.height) : 1;
    covered.push([c.offset, c.offset + along]);
  }
  covered.sort((a, b) => a[0] - b[0]);
  const out: Slot[] = [];
  let pos = 0;
  for (const [s, e] of covered) {
    if (s > pos) out.push({ start: pos, length: Math.min(s, length) - pos });
    pos = Math.max(pos, e);
    if (pos >= length) break;
  }
  if (pos < length) out.push({ start: pos, length: length - pos });
  return out.filter((s) => s.length > 0);
}

/**
 * つなげる区間を選ぶ（HMA と同じ規則）: 覆われていない区間のうち、MIN_SLOT マス以上でいちばん長いもの（同じ長さなら先のもの）。
 * 無ければ辺の端（終わり側）に MIN_SLOT マス。
 */
export function chooseSlot(
  main: MapSize & { readonly connections: readonly MapConnection[] | null | undefined },
  side: Side,
  sizeOf: (id: MapId) => MapSize | null,
): Slot {
  const slots = freeSlots(main, side, sizeOf).filter((s) => s.length >= MIN_SLOT);
  if (slots.length > 0) return slots.reduce((a, b) => (b.length > a.length ? b : a));
  return { start: Math.max(0, edgeLength(main, side) - MIN_SLOT), length: MIN_SLOT };
}

/**
 * 接続から作る新しいマップの大きさ。辺に沿った長さは区間の長さ、奥行きは NEW_CONNECTED_MAP_DEPTH。
 * 大きさの上限（`(幅+15)×(高さ+14) ≤ 10240`）を超えるときは、奥行き、次に辺に沿った長さを縮める。
 */
export function newConnectedMapSize(side: Side, slot: Slot): MapSize {
  let along = Math.max(1, slot.length);
  let depth = NEW_CONNECTED_MAP_DEPTH;
  const size = (): MapSize => (side === "up" || side === "down" ? { width: along, height: depth } : { width: depth, height: along });
  const fits = (): boolean => {
    const s = size();
    return (s.width + 15) * (s.height + 14) <= MAP_SIZE_LIMIT;
  };
  while (!fits() && depth > MIN_SLOT) depth--;
  while (!fits() && along > 1) along--;
  return size();
}

/**
 * 既存のマップとつなぐときのずれ（HMA と同じく、長さの差の半分で中央にそろえる）。
 * `mainLength` は自分の辺の長さ、`otherLength` は相手の、同じ向きに沿った長さ。
 */
export function centeredOffset(mainLength: number, otherLength: number): number {
  return Math.trunc((mainLength - otherLength) / 2);
}
