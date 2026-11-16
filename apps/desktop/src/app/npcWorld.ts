import { BEHAVIOR_MASK, type NpcSource, type NpcWorld } from "@zigzagumap/core";
import type { OpenMap } from "./ProjectSession";

/** 表示中のマップの通れるか（移動許可とブロックの挙動。編集をすぐ反映するよう、毎回マップから読む）。 */
export function npcWorldOf(map: OpenMap): NpcWorld {
  const doc = map.doc;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < doc.width && y < doc.height;
  return {
    width: doc.width,
    height: doc.height,
    movement: (x, y) => inside(x, y) ? doc.grid.getMovement(x, y) : null,
    behavior: (x, y) => inside(x, y) ? map.tiles.triple.attribute(doc.grid.getBlock(x, y)) & BEHAVIOR_MASK : 0,
  };
}

/** マップの人物（クローンは除く。別のマップの人物の写しなので、元のマップで動かす）。 */
export function npcSourcesOf(map: OpenMap | null): NpcSource[] {
  return (map?.doc.events?.persons ?? []).filter(p => p.kind === 0).map(p => ({
    localId: p.localId, graphicsId: p.graphicsId, x: p.x, y: p.y, elevation: p.elevation,
    movementType: p.movementType, movementRangeX: p.movementRangeX, movementRangeY: p.movementRangeY,
  }));
}
