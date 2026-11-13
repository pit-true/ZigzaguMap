import type { MapDocument } from "../../../model/MapDocument.js";
import { checkRange } from "../../EditError.js";
import { argEnum, argInt, argMapId, type Args } from "../../jsonArgs.js";
import { EventsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { EVENT_KINDS, requireEvent, type EventKind } from "./eventFields.js";

/** 「イベントを動かす」の引数。 */
export type MoveEventArgs = MapArgs & { kind: EventKind; index: number; x: number; y: number };

/**
 * 「イベントを動かす」コマンド（マップ上のドラッグ）。座標は 0〜0xFFFF。
 * マップの外にも置ける（AdvanceMap と同じ。警告は eventsOutsideMap で出す）。他のイベントと重なってもよい。
 */
export class MoveEventCommand extends EventsCommand<MoveEventArgs> {
  static readonly NAME = "moveEvent";
  readonly name = MoveEventCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): MoveEventCommand {
    return new MoveEventCommand({
      ...argMapId(args),
      kind: argEnum(args, "kind", EVENT_KINDS),
      index: argInt(args, "index"),
      x: argInt(args, "x"),
      y: argInt(args, "y"),
    });
  }

  protected edit(doc: MapDocument): void {
    const { kind, index, x, y } = this.args;
    const event = requireEvent(doc, kind, index) as { x: number; y: number };
    checkRange("x", x, 0, 0xffff);
    checkRange("y", y, 0, 0xffff);
    event.x = x;
    event.y = y;
  }
}

/** マップの外にあるイベント（AdvanceMap のステータスバーの「マップの外にイベントがあります。」用）。 */
export function eventsOutsideMap(doc: MapDocument): { kind: EventKind; index: number }[] {
  const out: { kind: EventKind; index: number }[] = [];
  if (!doc.events) return out;
  const lists: [EventKind, { x: number; y: number }[]][] = [
    ["person", doc.events.persons],
    ["warp", doc.events.warps],
    ["trap", doc.events.traps],
    ["sign", doc.events.signs],
  ];
  for (const [kind, list] of lists) {
    list.forEach((e, index) => {
      if (e.x >= doc.width || e.y >= doc.height) out.push({ kind, index });
    });
  }
  return out;
}
