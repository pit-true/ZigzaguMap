import { emptyTableTail } from "../../../mapscript/MapScriptCodec.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { checkRange } from "../../EditError.js";
import { argInt, argMapId, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { MapScriptsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { checkScriptType, isTableType, requireScript } from "./mapScriptChecks.js";

/** 「マップスクリプトを変える」の引数。省略した項目は変えない。 */
export type SetMapScriptArgs = MapArgs & {
  index: number;
  /** 種類（1〜255）。 */
  type?: number;
  /** スクリプトのポインタ（Phase2 でラベルに置き換わる値。条件表の種類では保存されない）。 */
  pointer?: number;
};

/**
 * 「マップスクリプトを変える」コマンド（種類のコンボとオフセット欄）。
 * 条件表の種類（2・4）へ変えると空の条件表を持ち、オフセットは保存されなくなる（値は控えておき、
 * 別の種類へ戻すと元のオフセットに戻る。AdvanceMap と同じ）。条件表の種類から外すと条件表は消える。
 */
export class SetMapScriptCommand extends MapScriptsCommand<SetMapScriptArgs> {
  static readonly NAME = "setMapScript";
  readonly name = SetMapScriptCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetMapScriptCommand {
    return new SetMapScriptCommand(
      compactArgs({ ...argMapId(args), index: argInt(args, "index"), type: argOptInt(args, "type"), pointer: argOptInt(args, "pointer") }) as SetMapScriptArgs,
    );
  }

  protected edit(doc: MapDocument): void {
    const entry = requireScript(doc, this.args.index);
    const type = this.args.type === undefined ? entry.type : checkScriptType(this.args.type);
    const pointer = this.args.pointer === undefined ? entry.pointer : checkRange("pointer", this.args.pointer, 0, 0xffffffff);
    if (isTableType(type) && !entry.table) entry.table = { entries: [], tail: emptyTableTail() };
    if (!isTableType(type)) entry.table = null;
    entry.type = type;
    entry.pointer = pointer;
  }
}
