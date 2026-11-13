import type { BlockGrid } from "../../map/BlockGrid.js";
import type { EditorContext } from "../Command.js";
import { readCells, readInt } from "../args.js";
import { PaintCellsCommand, type CellWrite } from "./PaintCellsCommand.js";

/** 「ブロックをまとめて置く」の引数。 */
export type PaintBlocksArgs = {
  bank: number;
  map: number;
  /** 置くマスとブロック番号（0〜0x3FF）。 */
  cells: { x: number; y: number; block: number }[];
};

/**
 * 「ブロックをまとめて置く」コマンド。1 回のクリック、ドラッグ 1 回分の連続配置、複数ブロックの配置に使う。
 * 移動許可は変えない。ドラッグ中の後続はまとめて 1 回の操作にする。
 */
export class PaintBlocksCommand extends PaintCellsCommand<PaintBlocksArgs> {
  static readonly NAME = "paintBlocks";
  readonly name = PaintBlocksCommand.NAME;

  constructor(args: PaintBlocksArgs) {
    super(args, args.cells.map((c) => ({ x: c.x, y: c.y, value: c.block })));
  }

  /** JSON の引数から作る（操作列の再生・MCP 用）。 */
  static fromJson(args: Record<string, unknown>): PaintBlocksCommand {
    return new PaintBlocksCommand({
      bank: readInt(args, "bank"),
      map: readInt(args, "map"),
      cells: readCells(args, "block").map((c) => ({ x: c.x, y: c.y, block: c.value })),
    });
  }

  protected target(context: EditorContext): BlockGrid {
    return context.grid(this.mapId);
  }

  protected write(grid: BlockGrid, cell: CellWrite): void {
    grid.setBlock(cell.x, cell.y, cell.value);
  }

  protected toArgs(writes: readonly CellWrite[]): PaintBlocksArgs {
    return { bank: this.args.bank, map: this.args.map, cells: writes.map((c) => ({ x: c.x, y: c.y, block: c.value })) };
  }
}
