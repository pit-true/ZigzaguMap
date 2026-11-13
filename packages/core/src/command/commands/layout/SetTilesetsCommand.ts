import type { MapDocument } from "../../../model/MapDocument.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argMapId, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { LayoutCommand, type MapArgs } from "../base/MapPartCommand.js";

/** 「タイルセットを変える」の引数。省略した側は変えない。 */
export type SetTilesetsArgs = MapArgs & {
  /** 主タイルセットのポインタ値（番号からは TilesetTable.pointerOf で求める）。 */
  primary?: number;
  /** 副タイルセットのポインタ値。 */
  secondary?: number;
};

/** タイルセットとして指せるか確かめる。違えば EditError（invalidTileset）。 */
export function checkTileset(context: DocumentContext, pointer: number): number {
  if (!Number.isInteger(pointer) || pointer < 0 || pointer > 0xffffffff || !context.tilesetExists(pointer >>> 0)) {
    throw new EditError(EditErrorCode.InvalidTileset, { pointer });
  }
  return pointer >>> 0;
}

/**
 * 「タイルセットを変える」コマンド（場所の設定タブの「タイルセットの変更」）。
 * 配置のブロック番号はそのまま（合わないタイルセットにすると絵が崩れるのも AdvanceMap と同じ）。
 */
export class SetTilesetsCommand extends LayoutCommand<SetTilesetsArgs> {
  static readonly NAME = "setTilesets";
  readonly name = SetTilesetsCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetTilesetsCommand {
    return new SetTilesetsCommand(
      compactArgs({ ...argMapId(args), primary: argOptInt(args, "primary"), secondary: argOptInt(args, "secondary") }) as SetTilesetsArgs,
    );
  }

  protected edit(doc: MapDocument, context: DocumentContext): void {
    const { primary, secondary } = this.args;
    const p = primary === undefined ? doc.primaryTileset : checkTileset(context, primary);
    const s = secondary === undefined ? doc.secondaryTileset : checkTileset(context, secondary);
    doc.primaryTileset = p;
    doc.secondaryTileset = s;
  }
}
