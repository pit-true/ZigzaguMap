import type { SignEvent } from "../../../event/types.js";
import { isHiddenItemKind } from "../../../event/SignCodec.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { checkRange } from "../../EditError.js";
import { argEnum, argFieldMap, argInt, argMapId, type Args } from "../../jsonArgs.js";
import { EventsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { EVENT_KINDS, checkEventField, eventList, reinterpretSign, requireEvent, writeEventField, type EventKind } from "./eventFields.js";

/** 「イベントの項目を変える」の引数。 */
export type SetEventFieldsArgs = MapArgs & {
  kind: EventKind;
  index: number;
  /** 項目名 → 値（例 `{ "graphicsId": 23, "movementType": 2 }`）。項目名は EVENT_FIELD_NAMES。 */
  fields: { [field: string]: number | boolean };
};

/**
 * 「イベントの項目を変える」コマンド。人・ワープ・スクリプトタイル・看板の各項目を変える。
 * 看板の `kind`（種別）を変えると、中身の 4 バイトを新しい種別として読み直す
 * （0〜4 はスクリプトのポインタ、5〜7 は隠しアイテムの道具・フラグ・個数）。
 * 同じ呼び出しで種別と中身の項目を両方渡したときは、種別を先に変える。
 */
export class SetEventFieldsCommand extends EventsCommand<SetEventFieldsArgs> {
  static readonly NAME = "setEventFields";
  readonly name = SetEventFieldsCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetEventFieldsCommand {
    return new SetEventFieldsCommand({
      ...argMapId(args),
      kind: argEnum(args, "kind", EVENT_KINDS),
      index: argInt(args, "index"),
      fields: argFieldMap(args, "fields"),
    });
  }

  protected edit(doc: MapDocument): void {
    const { kind, index, fields } = this.args;
    let event = requireEvent(doc, kind, index);
    const signKind = kind === "sign" && fields["kind"] !== undefined ? fields["kind"] : undefined;
    const hidden = typeof signKind === "number" ? isHiddenItemKind(checkRange("kind", signKind, 0, 0xff)) : undefined;
    // 先に全部確かめる（途中で失敗しても何も変えない）。
    const values = Object.entries(fields).map(([field, value]) => [field, checkEventField(kind, event, field, value, hidden)] as const);
    if (typeof signKind === "number") {
      event = reinterpretSign(event as SignEvent, signKind);
      (eventList(doc.events!, "sign") as SignEvent[])[index] = event as SignEvent;
    }
    for (const [field, value] of values) if (!(kind === "sign" && field === "kind")) writeEventField(kind, event, field, value);
  }
}
