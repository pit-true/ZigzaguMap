import type { BlockGrid } from "../../map/BlockGrid.js";
import { BLOCK_ID_MASK, MOVEMENT_SHIFT } from "../../map/constants.js";
import type { EditorContext } from "../Command.js";
import { readInt } from "../args.js";
import { PaintCellsCommand, type CellWrite } from "./PaintCellsCommand.js";

/** 「ブロックと移動許可をまとめて置く」の引数。 */
export type PaintCellValuesArgs = {
  bank: number;
  map: number;
  /** 置くマスと、ブロック番号（0〜0x3FF）・移動許可（0〜0x3F）。 */
  cells: { x: number; y: number; block: number; movement: number }[];
};

/**
 * 「ブロックと移動許可をまとめて置く」コマンド（`paintCells`。Phase3 #225）。マップから拾った複数選択（スタンプ）を、
 * 移動許可ごと貼るときに使う。控え方とドラッグ中のまとめ方は paintBlocks と同じ。
 */
export class PaintCellValuesCommand extends PaintCellsCommand<PaintCellValuesArgs> {
  static readonly NAME = "paintCells";
  readonly name = PaintCellValuesCommand.NAME;

  constructor(args: PaintCellValuesArgs) {
    super(
      args,
      args.cells.map((c) => {
        if (!Number.isInteger(c.block) || c.block < 0 || c.block > BLOCK_ID_MASK) throw new RangeError(`ブロック番号が範囲外です: ${c.block}`);
        if (!Number.isInteger(c.movement) || c.movement < 0 || c.movement > 0x3f) throw new RangeError(`移動許可が範囲外です: ${c.movement}`);
        return { x: c.x, y: c.y, value: (c.movement << MOVEMENT_SHIFT) | c.block };
      }),
    );
  }

  /** JSON の引数から作る（操作列の再生・MCP 用）。 */
  static fromJson(args: Record<string, unknown>): PaintCellValuesCommand {
    const cells = args["cells"];
    if (!Array.isArray(cells)) throw new TypeError("引数 cells は配列でなければなりません");
    return new PaintCellValuesCommand({
      bank: readInt(args, "bank"),
      map: readInt(args, "map"),
      cells: cells.map((cell: unknown, i) => {
        if (typeof cell !== "object" || cell === null) throw new TypeError(`cells[${i}] はオブジェクトでなければなりません`);
        const c = cell as Record<string, unknown>;
        return { x: readInt(c, "x"), y: readInt(c, "y"), block: readInt(c, "block"), movement: readInt(c, "movement") };
      }),
    });
  }

  protected target(context: EditorContext): BlockGrid {
    return context.grid(this.mapId);
  }

  protected write(grid: BlockGrid, cell: CellWrite): void {
    grid.setCell(cell.x, cell.y, cell.value);
  }

  protected toArgs(writes: readonly CellWrite[]): PaintCellValuesArgs {
    return {
      bank: this.args.bank,
      map: this.args.map,
      cells: writes.map((c) => ({ x: c.x, y: c.y, block: c.value & BLOCK_ID_MASK, movement: c.value >> MOVEMENT_SHIFT })),
    };
  }
}
