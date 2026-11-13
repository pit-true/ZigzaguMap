import {
  EVENT_HEADER_SIZE,
  MAP_HEADER_SIZE,
  PERSON_SIZE,
  ROM_BASE,
  SIGN_SIZE,
  TRAP_SIZE,
  WARP_SIZE,
  eventHeaderCodec,
  findFlyPosition,
  mapHeaderCodec,
  type CfruProject,
  type FlyPosition,
  type MapDocument,
  type MapEvents,
  type MapId,
} from "@zigzagumap/core";
import type { PlacedFly } from "../map/EventLayer";

/** 種別（フライトポジションを含む）。 */
export type UiKind = "person" | "sign" | "warp" | "trap" | "fly";
/** マップのイベントの表にある種別。 */
export type ListKind = Exclude<UiKind, "fly">;

/** 種別コンボの並び（AdvanceMap と同じ: 人、看板、ワープ、スクリプト、フライトポジション）。 */
export const KIND_ORDER: readonly UiKind[] = ["person", "sign", "warp", "trap", "fly"];

/** イベントマネージャーの並び（人、看板、ワープ、スクリプト）。 */
export const LIST_KINDS: readonly ListKind[] = ["person", "sign", "warp", "trap"];

/** 種別の一覧。 */
export function eventList(events: MapEvents, kind: ListKind): readonly { x: number; y: number }[] {
  switch (kind) {
    case "person":
      return events.persons;
    case "sign":
      return events.signs;
    case "warp":
      return events.warps;
    case "trap":
      return events.traps;
  }
}

/** 種別の個数。 */
export function listCount(doc: MapDocument, kind: ListKind): number {
  return doc.events ? eventList(doc.events, kind).length : 0;
}

/**
 * マップにイベントがあるか（表が無いか、4 種とも 0 件なら無い）。
 * 無いときは AdvanceMap と同じく「このマップにはイベントが存在しません」を出してマップを隠す。
 */
export function hasAnyEvent(doc: MapDocument): boolean {
  return LIST_KINDS.some((k) => listCount(doc, k) > 0);
}

/** 表示中のマップのフライトポジション（表の番号と値）。無ければ null。 */
export function mapFly(positions: readonly FlyPosition[], id: MapId): (PlacedFly & { readonly entry: FlyPosition }) | null {
  const index = findFlyPosition(positions, id);
  if (index < 0) return null;
  const entry = positions[index]!;
  return { index, x: entry.x, y: entry.y, entry };
}

/** 種別ごとのエントリーの大きさ。 */
const ENTRY_SIZE: Readonly<Record<ListKind, number>> = { person: PERSON_SIZE, sign: SIGN_SIZE, warp: WARP_SIZE, trap: TRAP_SIZE };

/**
 * ステータスバーに出すエントリーの ROM オフセット（AdvanceMap の「オフセット: 378DB4」）。
 * ベース ROM から読んだマップの、ROM にある番号のイベントだけ分かる（maps\ の JSON のマップや、増やした分は null）。
 */
export class EventOffsets {
  private readonly cache = new Map<string, Record<ListKind, { at: number; count: number }> | null>();

  constructor(private readonly project: CfruProject) {}

  /** イベントのエントリーの位置。 */
  entry(id: MapId, kind: ListKind, index: number): number | null {
    const lists = this.lists(id);
    const list = lists?.[kind];
    if (!list || index >= list.count) return null;
    return list.at + index * ENTRY_SIZE[kind];
  }

  /** フライトポジションのエントリーの位置。 */
  fly(index: number): number | null {
    return this.project.flyTable?.entryOffset(index) ?? null;
  }

  private lists(id: MapId): Record<ListKind, { at: number; count: number }> | null {
    const key = `${id.bank}.${id.map}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    let value: Record<ListKind, { at: number; count: number }> | null = null;
    try {
      if (!this.project.hasJson(id) && this.project.base.has(id)) {
        const rom = this.project.rom;
        const header = mapHeaderCodec.decode(rom.slice(this.project.base.bankTable.headerOffset(id), MAP_HEADER_SIZE));
        if (rom.isPointer(header.events)) {
          const h = eventHeaderCodec.decode(rom.slice(header.events - ROM_BASE, EVENT_HEADER_SIZE));
          value = {
            person: { at: h.persons - ROM_BASE, count: h.personCount },
            sign: { at: h.signs - ROM_BASE, count: h.signCount },
            warp: { at: h.warps - ROM_BASE, count: h.warpCount },
            trap: { at: h.traps - ROM_BASE, count: h.trapCount },
          };
        }
      }
    } catch {
      value = null;
    }
    this.cache.set(key, value);
    return value;
  }
}
