import { BlockGrid } from "../map/BlockGrid.js";
import type { MapLoader } from "../map/MapLoader.js";
import type { MapId } from "../map/types.js";
import type { EditorContext } from "./Command.js";

/** 編集中の配置を持つ EditorContext。初めて触ったマップは ROM から読んでコピーする。 */
export class GridStore implements EditorContext {
  private readonly grids = new Map<string, BlockGrid>();

  constructor(private readonly loader: MapLoader) {}

  grid(id: MapId): BlockGrid {
    const key = `${id.bank}.${id.map}`;
    let grid = this.grids.get(key);
    if (!grid) {
      const layout = this.loader.readLayout(id);
      grid = new BlockGrid(layout.width, layout.height, layout.blocks);
      this.grids.set(key, grid);
    }
    return grid;
  }

  /** そのマップを一度でも編集用に読み込んだか。 */
  has(id: MapId): boolean {
    return this.grids.has(`${id.bank}.${id.map}`);
  }
}
