import type { MapDocument } from "../../../model/MapDocument.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { LayoutCommand, type MapArgs } from "../base/MapPartCommand.js";
import { checkMapSize, resizeGrid } from "./mapSize.js";

/** 「マップの大きさを変える」の引数。 */
export type ResizeMapArgs = MapArgs & { width: number; height: number };

/**
 * 「マップの大きさを変える」コマンド（場所の設定タブの「マップサイズの変更」）。
 * 右と下へ伸縮し、元の絵は左上を基準に残る。増えたマスはブロック 0・移動許可 0（AdvanceMap と同じ黒）。
 * イベントと接続はそのまま（はみ出したイベントも残る）。
 * 上限は `(幅+15)×(高さ+14) ≤ 10240`（超えると EditError mapTooLarge）。
 */
export class ResizeMapCommand extends LayoutCommand<ResizeMapArgs> {
  static readonly NAME = "resizeMap";
  readonly name = ResizeMapCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): ResizeMapCommand {
    return new ResizeMapCommand({ ...argMapId(args), width: argInt(args, "width"), height: argInt(args, "height") });
  }

  protected edit(doc: MapDocument): void {
    const { width, height } = this.args;
    checkMapSize(width, height);
    doc.grid = resizeGrid(doc.grid, width, height);
  }
}
