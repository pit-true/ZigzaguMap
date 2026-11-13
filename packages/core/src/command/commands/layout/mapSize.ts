import { BlockGrid } from "../../../map/BlockGrid.js";
import { EditError, EditErrorCode } from "../../EditError.js";

/** マップの大きさの上限の係数（AdvanceMap と同じく `(幅+15)×(高さ+14) ≤ 10240`）。 */
export const MAP_SIZE_LIMIT = 10240;
const WIDTH_MARGIN = 15;
const HEIGHT_MARGIN = 14;

/** その幅で置ける最大の高さ（AdvanceMap の「The max map height at a map width of W is: H」の H）。 */
export function maxMapHeight(width: number): number {
  return Math.floor(MAP_SIZE_LIMIT / (width + WIDTH_MARGIN)) - HEIGHT_MARGIN;
}

/**
 * マップの大きさを確かめる。1 未満や整数でなければ EditError（invalidMapSize）、
 * `(幅+15)×(高さ+14)` が 10240 を超えれば EditError（mapTooLarge、引数 width と maxHeight）。
 */
export function checkMapSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new EditError(EditErrorCode.InvalidMapSize, { width, height });
  }
  if ((width + WIDTH_MARGIN) * (height + HEIGHT_MARGIN) > MAP_SIZE_LIMIT) {
    throw new EditError(EditErrorCode.MapTooLarge, { width, maxHeight: maxMapHeight(width) });
  }
}

/**
 * 右と下へ伸縮した新しい配置を作る。元の左上はそのまま残り、増えたマスは `fill`（AdvanceMap は 0 = ブロック 0・移動許可 0）。
 */
export function resizeGrid(grid: BlockGrid, width: number, height: number, fill = 0): BlockGrid {
  const out = new BlockGrid(width, height, new Uint16Array(width * height).fill(fill));
  for (let y = 0; y < Math.min(height, grid.height); y++) {
    for (let x = 0; x < Math.min(width, grid.width); x++) out.cells[y * width + x] = grid.cells[y * grid.width + x]!;
  }
  return out;
}

/**
 * 同じ並びのまま幅・高さだけを変えた配置を作る（AdvanceMap の高度なヘッダーで、フッターの幅・高さを書き換えて保存したときと同じ。
 * 配置のデータはそのままで、新しい幅で折り返して読む）。足りないマスは `fill`。
 */
export function reflowGrid(grid: BlockGrid, width: number, height: number, fill = 0): BlockGrid {
  const out = new Uint16Array(width * height).fill(fill);
  out.set(grid.cells.subarray(0, Math.min(out.length, grid.cells.length)));
  return new BlockGrid(width, height, out);
}
