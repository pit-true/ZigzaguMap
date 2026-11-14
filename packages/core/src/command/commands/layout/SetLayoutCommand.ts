import { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, argIntArray, argMapId, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { LayoutCommand, type MapArgs } from "../base/MapPartCommand.js";
import { checkMapSize } from "./mapSize.js";
import { checkTileset } from "./SetTilesetsCommand.js";

/** 「配置・ボーダー・タイルセットをまとめて差し替える」の引数。 */
export type SetLayoutArgs = MapArgs & {
  width: number;
  height: number;
  /** 配置（u16。ブロック番号と移動許可）を左上から横へ。幅×高さ個。 */
  cells: number[];
  borderWidth: number;
  borderHeight: number;
  /** ボーダー（u16）。ボーダーの幅×高さ個。 */
  border: number[];
  /** 主タイルセットのポインタ値（省略で変えない）。 */
  primary?: number;
  /** 副タイルセットのポインタ値（省略で変えない）。 */
  secondary?: number;
};

/**
 * 「配置・ボーダー・タイルセットをまとめて差し替える」コマンド（別の ROM からの移植で「配置も写す」とき。#314）。
 * 大きさも合わせる。イベント・接続には触れない（マップの外に出たイベントはそのまま。大きさの変更と同じ）。
 */
export class SetLayoutCommand extends LayoutCommand<SetLayoutArgs> {
  static readonly NAME = "setLayout";
  readonly name = SetLayoutCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetLayoutCommand {
    return new SetLayoutCommand(
      compactArgs({
        ...argMapId(args),
        width: argInt(args, "width"),
        height: argInt(args, "height"),
        cells: argIntArray(args, "cells"),
        borderWidth: argInt(args, "borderWidth"),
        borderHeight: argInt(args, "borderHeight"),
        border: argIntArray(args, "border"),
        primary: argOptInt(args, "primary"),
        secondary: argOptInt(args, "secondary"),
      }) as SetLayoutArgs,
    );
  }

  protected edit(doc: MapDocument, context: DocumentContext): void {
    const a = this.args;
    checkMapSize(a.width, a.height);
    if (a.cells.length !== a.width * a.height) throw new EditError(EditErrorCode.InvalidRawBytes, { field: "cells", expected: a.width * a.height * 2 });
    checkRange("borderWidth", a.borderWidth, 1, 0xff);
    checkRange("borderHeight", a.borderHeight, 1, 0xff);
    if (a.border.length !== a.borderWidth * a.borderHeight) throw new EditError(EditErrorCode.InvalidRawBytes, { field: "border", expected: a.borderWidth * a.borderHeight * 2 });
    a.cells.forEach((c) => checkRange("cells", c, 0, 0xffff));
    a.border.forEach((c) => checkRange("border", c, 0, 0xffff));
    const primary = a.primary === undefined ? doc.primaryTileset : checkTileset(context, a.primary);
    const secondary = a.secondary === undefined ? doc.secondaryTileset : checkTileset(context, a.secondary);
    doc.grid = new BlockGrid(a.width, a.height, Uint16Array.from(a.cells));
    doc.border = new BlockGrid(a.borderWidth, a.borderHeight, Uint16Array.from(a.border));
    doc.primaryTileset = primary;
    doc.secondaryTileset = secondary;
  }
}
