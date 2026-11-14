import type { EventLabelCounts } from "./EventLabelProject.js";
import type { EventPosition, EventPositions } from "./EventLabelStore.js";

/** ラベルを付けるイベントの並び（マップのイベントの `persons`・`signs`・`traps`）。 */
export interface LabeledEventLists {
  readonly persons: readonly EventPosition[];
  readonly signs: readonly EventPosition[];
  readonly traps: readonly EventPosition[];
}

/** イベントの座標（照合用。座標だけを写す）。イベントが無ければ空。 */
export function eventPositionsOf(events: LabeledEventLists | null | undefined): EventPositions {
  const xy = (list: readonly EventPosition[] | undefined): EventPosition[] => (list ?? []).map((v) => ({ x: v.x, y: v.y }));
  return { person: xy(events?.persons), sign: xy(events?.signs), tile: xy(events?.traps) };
}

/** 並びごとのイベントの数。イベントが無ければ 0。 */
export function eventLabelCountsOf(events: LabeledEventLists | null | undefined): EventLabelCounts {
  return { person: events?.persons.length ?? 0, sign: events?.signs.length ?? 0, tile: events?.traps.length ?? 0 };
}
