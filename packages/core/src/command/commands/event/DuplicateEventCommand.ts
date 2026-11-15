import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argEnum, argInt, argMapId, type Args } from "../../jsonArgs.js";
import { EventsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { ensureEvents } from "./AddEventCommand.js";
import { EVENT_KINDS, MAX_EVENTS_PER_KIND, eventList, requireEvent, type EventKind } from "./eventFields.js";

/** 「イベントを複製する」の引数。 */
export type DuplicateEventArgs = MapArgs & {
  kind: EventKind;
  /** 写す元のイベントの番号。 */
  index: number;
  /** 写しを置く位置。 */
  x: number;
  y: number;
};

/**
 * 「イベントを複製する」コマンド（Phase5 #399。イベントタブの Ctrl+D）。元のイベントの欄をすべて写し（フラグ・スクリプトも）、
 * その種類の末尾に足して `x`・`y` に置く。人の番号（localId）だけは、足した位置の番号（添字 + 1。AddEventCommand と同じ）にする。
 * 落とし物（`itemBalls`）は写さない（呼ぶ側が SetItemBallCommand を足す）。
 */
export class DuplicateEventCommand extends EventsCommand<DuplicateEventArgs> {
  static readonly NAME = "duplicateEvent";
  readonly name = DuplicateEventCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): DuplicateEventCommand {
    return new DuplicateEventCommand({
      ...argMapId(args),
      kind: argEnum(args, "kind", EVENT_KINDS),
      index: argInt(args, "index"),
      x: argInt(args, "x"),
      y: argInt(args, "y"),
    });
  }

  protected edit(doc: MapDocument): void {
    const { kind, index, x, y } = this.args;
    const source = requireEvent(doc, kind, index);
    checkRange("x", x, 0, 0xffff);
    checkRange("y", y, 0, 0xffff);
    const list = eventList(ensureEvents(doc), kind);
    if (list.length >= MAX_EVENTS_PER_KIND) throw new EditError(EditErrorCode.EventLimit, { kind, max: MAX_EVENTS_PER_KIND });
    // イベントは数と小さなオブジェクト（看板の中身）だけでできている
    const copy = JSON.parse(JSON.stringify(source)) as { x: number; y: number; localId?: number };
    copy.x = x;
    copy.y = y;
    if (kind === "person") copy.localId = (list.length + 1) & 0xff;
    list.push(copy);
  }
}
