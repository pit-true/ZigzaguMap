import { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { LayoutCommand, type MapArgs } from "../base/MapPartCommand.js";

/** 「マップシフト」の引数。`dx`・`dy` はずらすマス数（右・下が正）。 */
export type ShiftMapArgs = MapArgs & { dx: number; dy: number };

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * 配置全体（ブロックと移動許可）を `dx`・`dy` だけずらした新しい配置。はみ出た行と列は反対側に出る（回り込み）。
 * 大きさは変わらない。
 */
export function shiftGrid(grid: BlockGrid, dx: number, dy: number): BlockGrid {
  const { width: w, height: h } = grid;
  const out = new BlockGrid(w, h);
  const sx = mod(dx, w);
  const sy = mod(dy, h);
  for (let y = 0; y < h; y++) {
    const ny = (y + sy) % h;
    for (let x = 0; x < w; x++) out.cells[ny * w + ((x + sx) % w)] = grid.cells[y * w + x]!;
  }
  return out;
}

/**
 * 「マップシフト」コマンド（Phase5 #390。Porymap の Map Shift）。配置全体のブロックと移動許可をずらし、はみ出た分を反対側へ回す。
 * イベント・接続・境界ブロック・大きさは変えない（Q5 の推奨）。1 回の取り消しで戻る。ずらす量が 0 なら何も変えない。
 */
export class ShiftMapCommand extends LayoutCommand<ShiftMapArgs> {
  static readonly NAME = "shiftMap";
  readonly name = ShiftMapCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): ShiftMapCommand {
    return new ShiftMapCommand({ ...argMapId(args), dx: argInt(args, "dx"), dy: argInt(args, "dy") });
  }

  protected edit(doc: MapDocument): void {
    doc.grid = shiftGrid(doc.grid, this.args.dx, this.args.dy);
  }
}
