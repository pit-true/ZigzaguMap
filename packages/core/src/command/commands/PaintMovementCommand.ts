import type { BlockGrid } from "../../map/BlockGrid.js";
import type { EditorContext } from "../Command.js";
import { readCells, readInt } from "../args.js";
import { PaintCellsCommand, type CellWrite } from "./PaintCellsCommand.js";

/** 「移動許可をまとめて置く」の引数。 */
export type PaintMovementArgs = {
  bank: number;
  map: number;
  /** 置くマスと移動許可（0〜0x3F）。 */
  cells: { x: number; y: number; movement: number }[];
};

/** 「移動許可をまとめて置く」コマンド。ブロック番号は変えない。ドラッグ中の後続はまとめて 1 回の操作にする。 */
export class PaintMovementCommand extends PaintCellsCommand<PaintMovementArgs> {
  static readonly NAME = "paintMovement";
  readonly name = PaintMovementCommand.NAME;

  constructor(args: PaintMovementArgs) {
    super(args, args.cells.map((c) => ({ x: c.x, y: c.y, value: c.movement })));
  }

  /** JSON の引数から作る（操作列の再生・MCP 用）。 */
  static fromJson(args: Record<string, unknown>): PaintMovementCommand {
    return new PaintMovementCommand({
      bank: readInt(args, "bank"),
      map: readInt(args, "map"),
      cells: readCells(args, "movement").map((c) => ({ x: c.x, y: c.y, movement: c.value })),
    });
  }

  protected target(context: EditorContext): BlockGrid {
    return context.grid(this.mapId);
  }

  protected write(grid: BlockGrid, cell: CellWrite): void {
    grid.setMovement(cell.x, cell.y, cell.value);
  }

  protected toArgs(writes: readonly CellWrite[]): PaintMovementArgs {
    return { bank: this.args.bank, map: this.args.map, cells: writes.map((c) => ({ x: c.x, y: c.y, movement: c.value })) };
  }
}
