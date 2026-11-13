import { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, argIntArray, argMapId, type Args } from "../../jsonArgs.js";
import { LayoutCommand, type MapArgs } from "../base/MapPartCommand.js";

/** 「ボーダーを設定する」の引数。 */
export type SetBorderArgs = MapArgs & {
  /** ボーダーの幅（1〜255）。 */
  width: number;
  /** ボーダーの高さ（1〜255）。 */
  height: number;
  /** マスの値（u16。ブロック番号と移動許可）を左上から横へ。幅×高さ個。 */
  cells: number[];
};

/**
 * 「ボーダーを設定する」コマンド（高度なヘッダーの境界ブロックの幅・高さと「境界」欄）。
 * 大きさと中身をまとめて差し替える（1 マスずつの変更は paintBorder を使う）。
 */
export class SetBorderCommand extends LayoutCommand<SetBorderArgs> {
  static readonly NAME = "setBorder";
  readonly name = SetBorderCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetBorderCommand {
    return new SetBorderCommand({ ...argMapId(args), width: argInt(args, "width"), height: argInt(args, "height"), cells: argIntArray(args, "cells") });
  }

  protected edit(doc: MapDocument): void {
    const { width, height, cells } = this.args;
    checkRange("width", width, 1, 0xff);
    checkRange("height", height, 1, 0xff);
    if (cells.length !== width * height) throw new EditError(EditErrorCode.InvalidRawBytes, { field: "cells", expected: width * height * 2 });
    cells.forEach((c) => checkRange("cells", c, 0, 0xffff));
    doc.border = new BlockGrid(width, height, Uint16Array.from(cells));
  }
}
