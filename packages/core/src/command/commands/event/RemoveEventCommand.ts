import type { MapDocument } from "../../../model/MapDocument.js";
import { argEnum, argInt, argMapId, type Args } from "../../jsonArgs.js";
import { EventsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { EVENT_KINDS, eventList, requireEvent, type EventKind } from "./eventFields.js";
import { shiftItemBallsAfterRemoval } from "./itemBallIndex.js";

/** 「イベントを削除する」の引数。 */
export type RemoveEventArgs = MapArgs & { kind: EventKind; index: number };

/**
 * 「イベントを削除する」コマンド（AdvanceMap の「イベントの削除」）。後ろのイベントが前に詰まる。
 * 人を消したときは、その人の落とし物を消し、後ろの人の落とし物の番号を 1 つ詰める。
 */
export class RemoveEventCommand extends EventsCommand<RemoveEventArgs> {
  static readonly NAME = "removeEvent";
  readonly name = RemoveEventCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): RemoveEventCommand {
    return new RemoveEventCommand({ ...argMapId(args), kind: argEnum(args, "kind", EVENT_KINDS), index: argInt(args, "index") });
  }

  protected edit(doc: MapDocument): void {
    const { kind, index } = this.args;
    requireEvent(doc, kind, index);
    eventList(doc.events!, kind).splice(index, 1);
    if (kind === "person") shiftItemBallsAfterRemoval(doc, index);
  }
}
