/** MapDocument の各部分の深いコピー（コマンドの取り消し用の控えにも使う）。 */

import type { MapConnection } from "../connection/types.js";
import type { MapEvents } from "../event/types.js";
import type { MapScriptEntry } from "../mapscript/types.js";
import type { WildEncounters } from "../wild/types.js";
import type { ItemBall } from "./MapDocument.js";

/** イベントのコピー。 */
export function cloneEvents(events: MapEvents | null): MapEvents | null {
  return events
    ? {
        persons: events.persons.map((p) => ({ ...p })),
        warps: events.warps.map((w) => ({ ...w })),
        traps: events.traps.map((t) => ({ ...t })),
        signs: events.signs.map((s) => ({ ...s, content: { ...s.content } })),
      }
    : null;
}

/** 接続のコピー。 */
export function cloneConnections(connections: MapConnection[] | null): MapConnection[] | null {
  return connections ? connections.map((c) => ({ ...c })) : null;
}

/** マップスクリプトのコピー。 */
export function cloneMapScripts(scripts: MapScriptEntry[] | null): MapScriptEntry[] | null {
  return scripts
    ? scripts.map((e) => ({
        ...e,
        table: e.table ? { entries: e.table.entries.map((t) => ({ ...t })), tail: e.table.tail.slice() } : null,
      }))
    : null;
}

/** 野生のコピー。 */
export function cloneWild(wild: readonly WildEncounters[]): WildEncounters[] {
  return wild.map((w) => ({ time: w.time, areas: w.areas.map((a) => ({ rate: a.rate, slots: a.slots.map((s) => ({ ...s })) })) }));
}

/** 落とし物のコピー。 */
export function cloneItemBalls(items: readonly ItemBall[]): ItemBall[] {
  return items.map((i) => ({ ...i }));
}
