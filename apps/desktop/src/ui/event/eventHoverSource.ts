import type { MapDocument, MapId } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { jaEventHover as t } from "../../i18n/ja.eventHover";
import type { PlacedEvent } from "../map/EventLayer";
import type { RawCell } from "./EventMapInput";
import type { HoverSection, HoverSource } from "./EventHover";
import type { ScriptSummaries, SummaryResult } from "./ScriptSummaries";

/** 吹き出しの中身を作るのに要るもの（イベントタブと App が渡す）。 */
export interface EventHoverDeps {
  readonly state: EditorState;
  /** 表示中のイベント（描いた順）。 */
  placed(): readonly PlacedEvent[];
  /** スクリプトの要約（初めて使うときに作る）。 */
  summaries(): Promise<ScriptSummaries>;
}

/** 要約の答えを行にする。 */
export function summaryLines(result: SummaryResult): string[] {
  switch (result.kind) {
    case "none":
      return [t.noScript];
    case "missingLabel":
      return [t.missingLabel(result.label)];
    case "summary": {
      const lines: string[] = [];
      if (result.label) lines.push(t.label(result.label));
      if (result.missingLabel) lines.push(t.missingLabel(result.missingLabel), t.romFallback);
      const s = result.summary;
      lines.push(...s.entries.map((e) => t.entry(e)));
      if (s.entries.length === 0) lines.push(...(s.problems.length > 0 ? s.problems : [t.empty]));
      if (s.truncated) lines.push(t.more);
      return lines;
    }
  }
}

/** イベントのスクリプトのポインタ（無ければ 0）。 */
function scriptPointer(doc: MapDocument, e: PlacedEvent): number {
  const ev = doc.events;
  if (!ev) return 0;
  switch (e.kind) {
    case "person":
      return ev.persons[e.index]?.script ?? 0;
    case "trap":
      return ev.traps[e.index]?.script ?? 0;
    case "sign": {
      const c = ev.signs[e.index]?.content;
      return c?.type === "script" ? c.script : 0;
    }
    default:
      return 0;
  }
}

/** イベントタブの吹き出しの中身（#226）。 */
export function eventHoverSource(deps: EventHoverDeps): HoverSource {
  const { state } = deps;
  const mapName = (id: MapId): string | null => state.session?.catalog.get(id)?.name ?? null;
  const source: HoverSource = {
    enabled: () => state.tab === "event" && !!state.map,
    eventsAt: (cell: RawCell) => deps.placed().filter((e) => e.x === cell.x && e.y === cell.y).reverse(),
    quick: (e: PlacedEvent): HoverSection => {
      const doc = state.map?.doc;
      const title = t.title(ja.event.kindNames[e.kind] ?? e.kind, e.kind === "fly" ? 0 : e.index);
      if (!doc) return { title, lines: [] };
      const ev = doc.events;
      if (!ev) return { title, lines: [] };
      switch (e.kind) {
        case "person": {
          const p = ev.persons[e.index];
          const lines: string[] = [];
          if (p?.kind === 1) lines.push(t.clone(p.trainerRangeOrBerryTree, p.trainerType, p.elevation));
          else if (p && p.trainerType !== 0) lines.push(t.trainerPerson(p.trainerRangeOrBerryTree));
          return { title, lines };
        }
        case "sign":
          return { title, lines: [] };
        case "trap": {
          const tr = ev.traps[e.index];
          return { title, lines: tr ? [t.trapCondition(tr.variable, tr.value)] : [] };
        }
        case "warp": {
          const w = ev.warps[e.index];
          return { title, lines: w ? [t.warp(w.bank, w.map, mapName({ bank: w.bank, map: w.map }), w.warpId)] : [] };
        }
        case "fly":
          return { title, lines: [] };
      }
    },
    detail: (e: PlacedEvent) => {
      const map = state.map;
      const events = map?.doc.events;
      if (!map || !events || (e.kind !== "person" && e.kind !== "sign" && e.kind !== "trap")) return null;
      const content = e.kind === "sign" ? events.signs[e.index]?.content : null;
      if (content?.type === "hiddenItem") {
        // 隠しアイテム: 道具の名前だけ（名前の表は要約と同じものを使う）
        return deps.summaries().then((s) => {
          const base = source.quick(e);
          return { ...base, lines: [...base.lines, t.hiddenItem(s.itemName(content.item) ?? `#${content.item}`, content.amount)] };
        });
      }
      // クローンは参照先の人のスクリプトを使うので、要約しない
      if (e.kind === "person" && events.persons[e.index]?.kind === 1) return null;
      const pointer = scriptPointer(map.doc, e);
      const target = { map: map.id, kind: e.kind, index: e.index } as const;
      return deps.summaries().then(async (s) => {
        const result = await s.summarize(target, pointer);
        const base = source.quick(e);
        return { ...base, lines: [...base.lines, ...summaryLines(result)] };
      });
    },
  };
  return source;
}
