import type { MapDocument } from "../../../model/MapDocument.js";
import { checkRange } from "../../EditError.js";
import { argMapId, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { EventsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { ensureEvents } from "./AddEventCommand.js";
import { MAX_EVENTS_PER_KIND, eventList, newEvent, type EventKind } from "./eventFields.js";
import { trimItemBalls } from "./itemBallIndex.js";

/** 「イベントの数を変える」の引数。省略した種類は変えない。 */
export type SetEventCountsArgs = MapArgs & { persons?: number; warps?: number; traps?: number; signs?: number };

const KEYS: readonly [keyof SetEventCountsArgs & string, EventKind][] = [
  ["persons", "person"],
  ["warps", "warp"],
  ["traps", "trap"],
  ["signs", "sign"],
];

/**
 * 「イベントの数を変える」コマンド（AdvanceMap のイベントマネージャーの「設定」）。
 * 増やした分は末尾に初期値（全部 0）で足し、減らした分は末尾から消す。数は 0〜255。
 * イベントの表が無いマップで 1 つでも増やすと表を作る。人を減らしたときは、いなくなった人の落とし物も消える。
 */
export class SetEventCountsCommand extends EventsCommand<SetEventCountsArgs> {
  static readonly NAME = "setEventCounts";
  readonly name = SetEventCountsCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetEventCountsCommand {
    return new SetEventCountsCommand(
      compactArgs({
        ...argMapId(args),
        persons: argOptInt(args, "persons"),
        warps: argOptInt(args, "warps"),
        traps: argOptInt(args, "traps"),
        signs: argOptInt(args, "signs"),
      }) as SetEventCountsArgs,
    );
  }

  protected edit(doc: MapDocument): void {
    const wanted = KEYS.map(([key, kind]) => {
      const value = this.args[key] as number | undefined;
      return [kind, value === undefined ? undefined : checkRange(key, value, 0, MAX_EVENTS_PER_KIND)] as const;
    });
    const grows = wanted.some(([kind, n]) => n !== undefined && n > (doc.events ? eventList(doc.events, kind).length : 0));
    if (!doc.events && !grows) return;
    const events = ensureEvents(doc);
    for (const [kind, n] of wanted) {
      if (n === undefined) continue;
      const list = eventList(events, kind) as object[];
      if (n < list.length) list.length = n;
      while (list.length < n) list.push(newEvent(kind, list.length));
      if (kind === "person") trimItemBalls(doc, n);
    }
  }
}
