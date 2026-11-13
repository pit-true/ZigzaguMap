import { emptyTableTail } from "../../../mapscript/MapScriptCodec.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { checkRange } from "../../EditError.js";
import { argInt, argMapId, argOptInt, type Args } from "../../jsonArgs.js";
import { MapScriptsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { checkScriptLimit, checkScriptType, isTableType } from "./mapScriptChecks.js";

/** 「マップスクリプトを追加する」の引数。 */
export type AddMapScriptArgs = MapArgs & {
  /** 種類（1〜255）。 */
  type: number;
  /** スクリプトのポインタ（省略時 0。条件表の種類では使わない）。 */
  pointer?: number;
};

/**
 * 「マップスクリプトを追加する」コマンド（場所の設定タブの「スクリプト追加」）。末尾に足す。
 * AdvanceMap は種類 00（スクリプト未設定）・オフセット 0 で足して後から種類を選ぶが、
 * 種類 0 は一覧の終端と同じで保存できないため、ここでは種類を必ず受け取る。
 * 条件表の種類（2・4）は空の条件表を持つ。マップスクリプトの表が無いマップでは表を作る。
 */
export class AddMapScriptCommand extends MapScriptsCommand<AddMapScriptArgs> {
  static readonly NAME = "addMapScript";
  readonly name = AddMapScriptCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): AddMapScriptCommand {
    const pointer = argOptInt(args, "pointer");
    return new AddMapScriptCommand({ ...argMapId(args), type: argInt(args, "type"), ...(pointer === undefined ? {} : { pointer }) });
  }

  protected edit(doc: MapDocument): void {
    const type = checkScriptType(this.args.type);
    const pointer = checkRange("pointer", this.args.pointer ?? 0, 0, 0xffffffff);
    checkScriptLimit(doc.mapScripts?.length ?? 0);
    (doc.mapScripts ??= []).push({ type, pointer, table: isTableType(type) ? { entries: [], tail: emptyTableTail() } : null });
  }
}
