import type { MapDocument } from "../../../model/MapDocument.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { argFieldMap, argMapId, type Args } from "../../jsonArgs.js";
import { HeaderCommand, type MapArgs } from "../base/MapPartCommand.js";
import { applyHeaderFields, replaceHeader } from "./headerFields.js";

/** 「ヘッダーの項目を変える」の引数。 */
export type SetHeaderFieldsArgs = MapArgs & {
  /** 項目名 → 値（music, regionMapSectionId, cave, weather, mapType, battleType, flags, allowRunning など。HEADER_FIELD_NAMES）。 */
  fields: { [field: string]: number | boolean };
};

/**
 * 「ヘッダーの項目を変える」コマンド（場所の設定タブの音楽・マップ名・明るさ・天候・マップタイプ・戦闘背景・名前表示など）。
 * マップ名 ID（地名番号）を変えると、マップ名はその番号の名前になる。
 */
export class SetHeaderFieldsCommand extends HeaderCommand<SetHeaderFieldsArgs> {
  static readonly NAME = "setHeaderFields";
  readonly name = SetHeaderFieldsCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetHeaderFieldsCommand {
    return new SetHeaderFieldsCommand({ ...argMapId(args), fields: argFieldMap(args, "fields") });
  }

  protected edit(doc: MapDocument, context: DocumentContext): void {
    replaceHeader(doc, applyHeaderFields(doc.header, this.args.fields), context);
  }
}
