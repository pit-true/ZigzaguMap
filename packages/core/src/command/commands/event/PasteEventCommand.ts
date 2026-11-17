import type { MapDocument } from "../../../model/MapDocument.js";
import type { JsonObject } from "../../Command.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argEnum, argInt, argMapId, type Args } from "../../jsonArgs.js";
import { EventsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { ensureEvents } from "./AddEventCommand.js";
import { EVENT_KINDS, MAX_EVENTS_PER_KIND, eventList, newEvent, type EventKind } from "./eventFields.js";

/** 「イベントを貼り付ける」の引数。 */
export type PasteEventArgs = MapArgs & {
  kind: EventKind;
  /** 写したイベントの欄（コピーしたときの値。座標と人の番号は置くときに決める）。 */
  event: JsonObject;
  /** 置く位置。 */
  x: number;
  y: number;
  /**
   * 写したイベントのスクリプトのラベル（`{ label, kind }`。#519 の Q10 で同じラベルを指す）。無ければ付けない。
   * ラベルの番号の付け直し（EventLabelProject）が読み、貼った先のマップの eventscripts の行になる。
   */
  label?: JsonObject;
};

/**
 * 「イベントを貼り付ける」コマンド（Phase7 #519。イベントタブの Ctrl+V）。コピーしたイベントの欄をすべて写し（フラグ・スクリプトも）、
 * 開いているマップのその種類の末尾に足して `x`・`y` に置く。別のマップからコピーしたものも貼れる（欄は引数に持つ）。
 * 人の番号（localId）だけは、足した位置の番号（添字 + 1。複製と同じ）にする。落とし物は呼ぶ側が SetItemBallCommand を足す。
 */
export class PasteEventCommand extends EventsCommand<PasteEventArgs> {
  static readonly NAME = "pasteEvent";
  readonly name = PasteEventCommand.NAME;

  static fromJson(args: Args): PasteEventCommand {
    const event = args["event"];
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new EditError(EditErrorCode.UnknownField, { field: "event" });
    const label = args["label"];
    return new PasteEventCommand({
      ...argMapId(args),
      kind: argEnum(args, "kind", EVENT_KINDS),
      event: event as JsonObject,
      x: argInt(args, "x"),
      y: argInt(args, "y"),
      ...(label && typeof label === "object" && !Array.isArray(label) ? { label: label as JsonObject } : {}),
    });
  }

  protected edit(doc: MapDocument): void {
    const { kind, event, x, y } = this.args;
    checkRange("x", x, 0, 0xffff);
    checkRange("y", y, 0, 0xffff);
    const list = eventList(ensureEvents(doc), kind);
    if (list.length >= MAX_EVENTS_PER_KIND) throw new EditError(EditErrorCode.EventLimit, { kind, max: MAX_EVENTS_PER_KIND });
    // 欄の形は新しいイベントに合わせ、写した値で埋める（知らない欄は持ち込まない）
    const copy = newEvent(kind, list.length) as unknown as Record<string, unknown>;
    for (const key of Object.keys(copy)) if (key in event) copy[key] = JSON.parse(JSON.stringify(event[key]));
    copy["x"] = x;
    copy["y"] = y;
    if (kind === "person") copy["localId"] = (list.length + 1) & 0xff;
    list.push(copy);
  }
}
