import type { BlockGrid } from "../../map/BlockGrid.js";
import type { EditorContext } from "../Command.js";
import { readCells, readInt } from "../args.js";
import { PaintCellsCommand, type CellWrite } from "./PaintCellsCommand.js";

/** 「ボーダーにブロックを置く」の引数。 */
export type PaintBorderArgs = {
  bank: number;
  map: number;
  /** ボーダー内の位置とブロック番号。 */
  cells: { x: number; y: number; block: number }[];
};

/** 「ボーダーにブロックを置く」コマンド。EditorContext に `border` が無ければ失敗する。 */
export class PaintBorderCommand extends PaintCellsCommand<PaintBorderArgs> {
  static readonly NAME = "paintBorder";
  readonly name = PaintBorderCommand.NAME;

  constructor(args: PaintBorderArgs) {
    super(args, args.cells.map((c) => ({ x: c.x, y: c.y, value: c.block })));
  }

  /** JSON の引数から作る（操作列の再生・MCP 用）。 */
  static fromJson(args: Record<string, unknown>): PaintBorderCommand {
    return new PaintBorderCommand({
      bank: readInt(args, "bank"),
      map: readInt(args, "map"),
      cells: readCells(args, "block").map((c) => ({ x: c.x, y: c.y, block: c.value })),
    });
  }

  protected target(context: EditorContext): BlockGrid {
    if (!context.border) throw new Error("ボーダーを編集できません");
    return context.border(this.mapId);
  }

  protected write(grid: BlockGrid, cell: CellWrite): void {
    grid.setBlock(cell.x, cell.y, cell.value);
  }

  protected toArgs(writes: readonly CellWrite[]): PaintBorderArgs {
    return { bank: this.args.bank, map: this.args.map, cells: writes.map((c) => ({ x: c.x, y: c.y, block: c.value })) };
  }
}
