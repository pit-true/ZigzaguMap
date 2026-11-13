import type { Command, EditorContext } from "../Command.js";
import { readInt } from "../args.js";

/** 「ブロックを置く」の引数。 */
export type PlaceBlockArgs = {
  bank: number;
  map: number;
  x: number;
  y: number;
  /** ブロック番号（0〜0x3FF）。 */
  block: number;
};

/** 「ブロックを置く」コマンド。移動許可は変えない。 */
export class PlaceBlockCommand implements Command<PlaceBlockArgs> {
  static readonly NAME = "placeBlock";
  readonly name = PlaceBlockCommand.NAME;
  private previous: number | null = null;

  constructor(readonly args: PlaceBlockArgs) {}

  /** JSON の引数から作る（操作列の再生・MCP 用）。 */
  static fromJson(args: Record<string, unknown>): PlaceBlockCommand {
    return new PlaceBlockCommand({
      bank: readInt(args, "bank"),
      map: readInt(args, "map"),
      x: readInt(args, "x"),
      y: readInt(args, "y"),
      block: readInt(args, "block"),
    });
  }

  do(context: EditorContext): void {
    const { bank, map, x, y, block } = this.args;
    const grid = context.grid({ bank, map });
    this.previous = grid.getCell(x, y);
    grid.setBlock(x, y, block);
  }

  undo(context: EditorContext): void {
    if (this.previous === null) return;
    const { bank, map, x, y } = this.args;
    context.grid({ bank, map }).setCell(x, y, this.previous);
  }
}
