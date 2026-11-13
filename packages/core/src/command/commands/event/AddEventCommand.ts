import type { MapEvents } from "../../../event/types.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argEnum, argMapId, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { EventsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { EVENT_KINDS, MAX_EVENTS_PER_KIND, eventList, newEvent, type EventKind } from "./eventFields.js";

/** 「イベントを追加する」の引数。 */
export type AddEventArgs = MapArgs & {
  kind: EventKind;
  /** 置く位置（省略時は 0, 0。AdvanceMap の初期値）。 */
  x?: number;
  y?: number;
};

/** イベントが無いマップでは空の表を作る。 */
export function ensureEvents(doc: MapDocument): MapEvents {
  return (doc.events ??= { persons: [], warps: [], traps: [], signs: [] });
}

/**
 * 「イベントを追加する」コマンド。末尾に初期値（全部 0）のイベントを足す。
 * イベントの表が無いマップでは表を作る（AdvanceMap のイベントマネージャーで数を増やしたときと同じ）。
 */
export class AddEventCommand extends EventsCommand<AddEventArgs> {
  static readonly NAME = "addEvent";
  readonly name = AddEventCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): AddEventCommand {
    return new AddEventCommand(
      compactArgs({ ...argMapId(args), kind: argEnum(args, "kind", EVENT_KINDS), x: argOptInt(args, "x"), y: argOptInt(args, "y") }) as AddEventArgs,
    );
  }

  protected edit(doc: MapDocument): void {
    const { kind, x = 0, y = 0 } = this.args;
    checkRange("x", x, 0, 0xffff);
    checkRange("y", y, 0, 0xffff);
    const count = doc.events ? eventList(doc.events, kind).length : 0;
    if (count >= MAX_EVENTS_PER_KIND) throw new EditError(EditErrorCode.EventLimit, { kind, max: MAX_EVENTS_PER_KIND });
    const event = newEvent(kind, count);
    Object.assign(event, { x, y });
    (eventList(ensureEvents(doc), kind) as object[]).push(event);
  }
}
