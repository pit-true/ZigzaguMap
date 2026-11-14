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

/**
 * 座標を、いちばん近いマップの内側の座標にする。16 ビットで負に回った値（0x8000 以上）は左・上の外とみなして 0 にする。
 * `size` は横幅か高さ（1 以上）。
 */
export function nearestInside(value: number, size: number): number {
  if (value < size) return value;
  return value >= 0x8000 ? 0 : Math.max(0, size - 1);
}

/**
 * マップの外にある全イベントを、いちばん近いマップの内側へ動かすコマンド（イベントタブの「マップの内側に戻す」）。
 * 外のイベントが無ければ空の配列。1 回の操作にするには CommandGroup.of でまとめる。
 */
export function moveEventsInsideCommands(doc: MapDocument, id: { bank: number; map: number }): MoveEventCommand[] {
  const lists: Readonly<Record<EventKind, readonly { x: number; y: number }[]>> = doc.events
    ? { person: doc.events.persons, warp: doc.events.warps, trap: doc.events.traps, sign: doc.events.signs }
    : { person: [], warp: [], trap: [], sign: [] };
  return eventsOutsideMap(doc).map(({ kind, index }) => {
    const e = lists[kind][index]!;
    return new MoveEventCommand({ ...id, kind, index, x: nearestInside(e.x, doc.width), y: nearestInside(e.y, doc.height) });
  });
}
