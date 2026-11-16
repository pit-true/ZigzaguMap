import { layoutNeighbors, type MapDocument } from "@zigzagumap/core";
import type { OpenMap, ProjectSession } from "./ProjectSession";

/** 実機の仮想マップへ写す隣のブロック。表示メニューの帯のオン・オフに依存しない。 */
export async function sceneNeighborBlocks(session: ProjectSession, map: OpenMap): Promise<(x: number, y: number) => number | null> {
  const docs = new Map<string, MapDocument>();
  const connections = (map.doc.connections ?? []).filter(c => c.direction >= 1 && c.direction <= 4);
  const ids = new Map(connections.map(c => [`${c.bank}.${c.map}`, { bank: c.bank, map: c.map }]));
  await Promise.all([...ids].map(async ([key, id]) => {
    try { const doc = await session.project.peek(id); if (doc) docs.set(key, doc); }
    catch { /* 読めない接続先は境界ブロックで表示する。編集データは作らない。 */ }
  }));
  const layout = layoutNeighbors({ width: map.doc.width, height: map.doc.height, connections: map.doc.connections }, id => docs.get(`${id.bank}.${id.map}`) ?? null, 8);
  const neighbors = [...layout.neighbors].reverse();
  return (x, y) => {
    for (const neighbor of neighbors) {
      const at = neighbor.bandAt;
      if (x < at.x || y < at.y || x >= at.x + at.width || y >= at.y + at.height) continue;
      const doc = docs.get(`${neighbor.id.bank}.${neighbor.id.map}`)!;
      return doc.grid.getBlock(neighbor.band.x + x - at.x, neighbor.band.y + y - at.y);
    }
    return null;
  };
}
