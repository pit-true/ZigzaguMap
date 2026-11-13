import type { Command, EditorContext } from "../Command.js";
import { readInt } from "../args.js";

/** 「移動許可を置く」の引数。 */
export type PlaceMovementArgs = {
  bank: number;
  map: number;
  x: number;
  y: number;
  /** 移動許可（0〜0x3F）。 */
  movement: number;
};

/** 「移動許可を置く」コマンド。ブロック番号は変えない。 */
export class PlaceMovementCommand implements Command<PlaceMovementArgs> {
  static readonly NAME = "placeMovement";
  readonly name = PlaceMovementCommand.NAME;
  private previous: number | null = null;

  constructor(readonly args: PlaceMovementArgs) {}

  /** JSON の引数から作る（操作列の再生・MCP 用）。 */
  static fromJson(args: Record<string, unknown>): PlaceMovementCommand {
    return new PlaceMovementCommand({
      bank: readInt(args, "bank"),
      map: readInt(args, "map"),
      x: readInt(args, "x"),
      y: readInt(args, "y"),
      movement: readInt(args, "movement"),
    });
  }

  do(context: EditorContext): void {
    const { bank, map, x, y, movement } = this.args;
    const grid = context.grid({ bank, map });
    this.previous = grid.getCell(x, y);
    grid.setMovement(x, y, movement);
  }

  undo(context: EditorContext): void {
    if (this.previous === null) return;
    const { bank, map, x, y } = this.args;
    context.grid({ bank, map }).setCell(x, y, this.previous);
  }
}
