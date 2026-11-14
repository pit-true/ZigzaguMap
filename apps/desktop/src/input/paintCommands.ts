import { PaintBlocksCommand, PaintCellValuesCommand, type Command } from "@zigzagumap/core";
import type { BlockSelection } from "../app/EditorState";
import type { FillCell } from "./paintPlans";

/** 分けたあとのマスはどれもそのマップの中（MapCells.split が確かめる）。 */
export const alwaysInside = { inBounds: (): boolean => true };

/**
 * マスの一覧を書くコマンド（マップの外の分は書かない。書くマスが無ければ null）。
 * 移動許可を持つマスがあり `withMovements` なら paintCells（ブロックと移動許可）、そうでなければ paintBlocks（ブロックだけ）。
 */
export function cellsCommand(id: { bank: number; map: number }, grid: { inBounds(x: number, y: number): boolean }, list: readonly FillCell[], withMovements: boolean): Command | null {
  const cells = list.filter((c) => grid.inBounds(c.x, c.y));
  if (cells.length === 0) return null;
  if (withMovements && cells.every((c) => c.movement !== undefined)) {
    return new PaintCellValuesCommand({ bank: id.bank, map: id.map, cells: cells.map((c) => ({ x: c.x, y: c.y, block: c.block, movement: c.movement! })) });
  }
  return new PaintBlocksCommand({ bank: id.bank, map: id.map, cells: cells.map(({ x, y, block }) => ({ x, y, block })) });
}

/** 移動許可の数がブロックと合わない選択は、移動許可を持たないものとして扱う（穴はそのまま）。 */
export function usableSelection(s: BlockSelection): BlockSelection {
  if (s.movements === undefined || s.movements.length === s.blocks.length) return s;
  return { width: s.width, height: s.height, blocks: s.blocks, ...(s.holes ? { holes: s.holes } : {}) };
}
