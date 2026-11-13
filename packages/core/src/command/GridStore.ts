import { BlockGrid } from "../map/BlockGrid.js";
import type { MapLoader } from "../map/MapLoader.js";
import type { MapId } from "../map/types.js";
import type { MapDocument } from "../model/MapDocument.js";
import type { EditorContext } from "./Command.js";

/** マップの配置を初めて求められたときに返す関数。 */
export type GridSource = (id: MapId) => BlockGrid;

/**
 * 編集中の配置を持つ EditorContext。
 * MapLoader を渡すと、初めて触ったマップは ROM から読んでコピーする。
 * 関数を渡すと、その戻り値をそのまま使う（MapDocument の配置を直接編集するときなど）。
 */
export class GridStore implements EditorContext {
  private readonly grids = new Map<string, BlockGrid>();
  private readonly borders = new Map<string, BlockGrid>();
  private readonly source: GridSource;
  private readonly borderSource: GridSource | null;

  /** `borderSource` を省略すると、MapLoader を渡したときは ROM のボーダーを、関数を渡したときはボーダーなしとする。 */
  constructor(source: MapLoader | GridSource, borderSource?: GridSource) {
    if (typeof source === "function") {
      this.source = source;
      this.borderSource = borderSource ?? null;
    } else {
      this.source = (id) => {
        const layout = source.readLayout(id);
        return new BlockGrid(layout.width, layout.height, layout.blocks);
      };
      this.borderSource =
        borderSource ??
        ((id) => {
          const layout = source.readLayout(id);
          return new BlockGrid(layout.borderWidth, layout.borderHeight, layout.border);
        });
    }
  }

  /** MapDocument の配置とボーダーを直接編集する GridStore を作る。`document` は読み込み済みのマップを返すこと。 */
  static forDocuments(document: (id: MapId) => MapDocument): GridStore {
    return new GridStore(
      (id) => document(id).grid,
      (id) => document(id).border,
    );
  }

  grid(id: MapId): BlockGrid {
    const key = `${id.bank}.${id.map}`;
    let grid = this.grids.get(key);
    if (!grid) {
      grid = this.source(id);
      this.grids.set(key, grid);
    }
    return grid;
  }

  border(id: MapId): BlockGrid {
    if (!this.borderSource) throw new Error("ボーダーを編集できません");
    const key = `${id.bank}.${id.map}`;
    let border = this.borders.get(key);
    if (!border) {
      border = this.borderSource(id);
      this.borders.set(key, border);
    }
    return border;
  }

  /** そのマップを一度でも編集用に読み込んだか。 */
  has(id: MapId): boolean {
    return this.grids.has(`${id.bank}.${id.map}`);
  }

  /** 保持している配置を捨てる（マップを読み直したときなど）。 */
  forget(id: MapId): void {
    this.grids.delete(`${id.bank}.${id.map}`);
    this.borders.delete(`${id.bank}.${id.map}`);
  }
}
