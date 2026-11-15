import type { Side } from "../../../connection/NeighborLayout.js";
import type { MapId } from "../../../map/types.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { MIN_EDGE_RESIZE, ResizeMapEdgeCommand, type EdgeFill } from "./ResizeMapEdgeCommand.js";
import { checkMapSize } from "./mapSize.js";

/** 4 辺それぞれに広げるマス数（負なら縮める）。 */
export interface BoxResize {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
}

/** 4 辺を変えたあとの大きさ。 */
export function boxSize(width: number, height: number, box: BoxResize): { width: number; height: number } {
  return { width: width + box.left + box.right, height: height + box.up + box.down };
}

/**
 * 4 辺の変更を、辺ごとの `ResizeMapEdgeCommand` の並びにする（Phase5 #390 の対話式リサイズ。`CommandGroup` で 1 回の操作にする）。
 * - 途中の大きさが上限を超えないよう、縮める辺を先に、広げる辺を後にする。ただし縮めた途中で幅か高さが MIN_EDGE_RESIZE を
 *   下回る向きは、その向きの広げる辺を先にする。
 * - `fill`（広げた所を埋める柄）は、できあがりの配置の座標でそろうよう、後の辺で左・上へずれる分を辺ごとに足して渡す。
 * - 変えない辺は入れない。できあがりの大きさが上限を超える・小さすぎるときは EditError を投げる。
 */
export function boxResizeCommands(self: MapId, width: number, height: number, box: BoxResize, partners: readonly MapId[], fill?: EdgeFill): ResizeMapEdgeCommand[] {
  const size = boxSize(width, height, box);
  if (size.width < MIN_EDGE_RESIZE || size.height < MIN_EDGE_RESIZE) throw new EditError(EditErrorCode.InvalidMapSize, size);
  checkMapSize(size.width, size.height);
  const amount = (s: Side): number => box[s as keyof BoxResize];
  const first: Side[] = [];
  const shrinks: Side[] = [];
  const grows: Side[] = [];
  for (const [a, b, length] of [["left", "right", width] as const, ["up", "down", height] as const]) {
    const sides = ([a, b] as Side[]).filter((s) => amount(s) !== 0);
    const shrunk = length + sides.filter((s) => amount(s) < 0).reduce((n, s) => n + amount(s), 0);
    for (const s of sides) {
      if (amount(s) > 0) (shrunk < MIN_EDGE_RESIZE ? first : grows).push(s);
      else shrinks.push(s);
    }
  }
  const order = [...first, ...shrinks, ...grows];
  return order.map((side, i) => {
    if (!fill) return ResizeMapEdgeCommand.of(self, side, amount(side), partners);
    const later = order.slice(i + 1);
    const ox = later.filter((s) => s === "left").reduce((n, s) => n + amount(s), 0);
    const oy = later.filter((s) => s === "up").reduce((n, s) => n + amount(s), 0);
    return ResizeMapEdgeCommand.of(self, side, amount(side), partners, { ...fill, ox: (fill.ox ?? 0) + ox, oy: (fill.oy ?? 0) + oy });
  });
}
