import { MAP_NAME_MAX_BYTES, hasMapName } from "../../../name/MapNameTable.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argInt, argString, type Args } from "../../jsonArgs.js";
import { SnapshotCommand } from "../base/SnapshotCommand.js";

/** 「マップ名を変える」の引数。 */
export type SetMapNameArgs = {
  /** 地名番号（0x58〜0xC4）。 */
  regionId: number;
  /** 新しい名前（エスケープ `[XX]` も可）。 */
  text: string;
};

/**
 * 「マップ名を変える」コマンド（場所の設定タブの「名前の変更を保存」）。名前表の項目を書き換えるので、
 * 同じ地名番号を使う全マップの名前が変わる（保存時に該当するマップの JSON を全部書く）。
 */
export class SetMapNameCommand extends SnapshotCommand<SetMapNameArgs, Uint8Array | null> {
  static readonly NAME = "setMapName";
  readonly name = SetMapNameCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetMapNameCommand {
    return new SetMapNameCommand({ regionId: argInt(args, "regionId"), text: argString(args, "text") });
  }

  protected capture(context: DocumentContext): Uint8Array | null {
    return context.mapNameEdit(this.args.regionId);
  }

  protected apply(context: DocumentContext): void {
    const { regionId, text } = this.args;
    if (!hasMapName(regionId)) throw new EditError(EditErrorCode.NoMapName, { regionId });
    const invalid = context.textCodec.firstInvalidChar(text);
    if (invalid !== null) throw new EditError(EditErrorCode.MapNameInvalidChar, { char: invalid });
    const bytes = context.textCodec.encode(text);
    if (bytes.length > MAP_NAME_MAX_BYTES) throw new EditError(EditErrorCode.MapNameTooLong, { length: bytes.length, max: MAP_NAME_MAX_BYTES });
    context.setMapNameEdit(regionId, bytes);
  }

  protected restore(context: DocumentContext, saved: Uint8Array | null): void {
    context.setMapNameEdit(this.args.regionId, saved);
  }
}
