/**
 * ブロックの挙動の番号（属性の下位 9 ビット。FR の値）のうち、ワープとして働くもの（#240）。
 * 番号は CFRU の `include/constants/metatile_behaviors.h`（素の FR と同じ値）。
 */

/** 挙動の番号の部分（属性の u32 の下位 9 ビット）。 */
export const BEHAVIOR_MASK = 0x1ff;

/** ワープとして働く挙動（洞窟の出入り口・はしご・矢印の出口・落とし穴・ワープ床・ドア・エスカレーター・階段・ユニオンルーム）。 */
export const WARP_BEHAVIORS: ReadonlyMap<number, string> = new Map([
  [0x60, "MB_CAVE_DOOR"],
  [0x61, "MB_LADDER"],
  [0x62, "MB_EAST_ARROW_WARP"],
  [0x63, "MB_WEST_ARROW_WARP"],
  [0x64, "MB_NORTH_ARROW_WARP"],
  [0x65, "MB_SOUTH_ARROW_WARP"],
  [0x66, "MB_FALL_WARP"],
  [0x67, "MB_REGULAR_WARP"],
  [0x68, "MB_68"],
  [0x69, "MB_WARP_DOOR"],
  [0x6a, "MB_UP_ESCALATOR"],
  [0x6b, "MB_DOWN_ESCALATOR"],
  [0x6c, "MB_UP_RIGHT_STAIR_WARP"],
  [0x6d, "MB_UP_LEFT_STAIR_WARP"],
  [0x6e, "MB_DOWN_RIGHT_STAIR_WARP"],
  [0x6f, "MB_DOWN_LEFT_STAIR_WARP"],
  [0x71, "MB_UNION_ROOM_WARP"],
]);

/** 属性（u32）か挙動の番号から、ワープとして働くか。 */
export function isWarpBehavior(attributeOrBehavior: number): boolean {
  return WARP_BEHAVIORS.has(attributeOrBehavior & BEHAVIOR_MASK);
}
