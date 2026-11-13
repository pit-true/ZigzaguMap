import type { MapEvents } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { attachCellPointer } from "../../input/CellPointer";
import { hex, ja } from "../../i18n/ja";
import { drawEvents, placedEvents, type EventKind, type PlacedEvent } from "../map/EventLayer";
import { MapView } from "../map/MapView";
import { fieldTable, selectBox } from "./fields";

/** 種別の並び（AdvanceMap の種別コンボの順: 人、ワープ、スクリプト、看板）。 */
const KINDS: readonly EventKind[] = ["person", "warp", "trap", "sign"];

/**
 * イベントタブ（今回は表示のみ）。マップ上にイベントを種別ごとの色の箱で描き、
 * クリックしたイベント（または右の欄で選んだイベント）の値を読み取り専用で出す。
 */
export class EventTab {
  readonly element: HTMLElement;
  readonly view: MapView;
  private readonly kind: HTMLSelectElement;
  private readonly number: HTMLSelectElement;
  private readonly fields: HTMLElement;
  private events: PlacedEvent[] = [];
  private selected: PlacedEvent | null = null;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("div");
    this.element.className = "event-tab";
    this.view = new MapView("event-tab-view");
    const side = document.createElement("div");
    side.className = "side-panel";
    this.kind = selectBox(ja.eventTypes);
    this.number = selectBox([]);
    this.fields = document.createElement("div");
    const numberRow = document.createElement("label");
    numberRow.className = "field-row";
    numberRow.append(ja.eventNumber, this.number);
    side.append(this.kind, numberRow, this.fields);
    this.element.append(this.view.element, side);

    this.kind.addEventListener("change", () => this.selectFirstOf(KINDS[this.kind.selectedIndex]!));
    this.number.addEventListener("change", () => {
      const kind = KINDS[this.kind.selectedIndex]!;
      this.select(this.events.find((e) => e.kind === kind && e.index === this.number.selectedIndex) ?? null);
    });
    attachCellPointer(this.view.stage, (e) => this.view.cellAt(e), {
      down: (cell, g) => {
        if (g.button !== 0) return;
        const hit = [...this.events].reverse().find((e) => e.x === cell.x && e.y === cell.y);
        if (hit) this.select(hit);
      },
      hover: (cell) => {
        if (!cell || !this.state.map) return;
        const hit = [...this.events].reverse().find((e) => e.x === cell.x && e.y === cell.y);
        state.setStatus(ja.statusEventCell(cell.x, cell.y, hit ? `${ja.eventKindNames[hit.kind]}${hit.index}` : ja.noEvents));
      },
    });

    state.on("map", () => this.showMap());
    state.on("cells", () => this.view.sync());
    state.on("view", () => this.configure());
    state.on("tab", () => {
      if (state.tab === "event") this.showNote();
    });
    this.configure();
  }

  private configure(): void {
    const s = this.state.settings.data;
    this.view.configure(s.zoomEvent ? 2 : 1, s.grid);
    this.draw();
  }

  private showMap(): void {
    this.view.setImage(this.state.mapImage);
    this.events = placedEvents(this.state.map?.doc.events ?? null);
    this.selected = null;
    this.selectFirstOf(KINDS[this.kind.selectedIndex] ?? "person");
    if (this.state.tab === "event") this.showNote();
  }

  /** ステータスバー右欄のノート（マップの外にイベントがあるか）。 */
  private showNote(): void {
    const map = this.state.map;
    if (!map) return;
    const outside = this.events.some((e) => !map.doc.grid.inBounds(e.x, e.y));
    this.state.setStatusRight(outside ? ja.noteOutside : ja.noteOk);
  }

  private selectFirstOf(kind: EventKind): void {
    this.select(this.events.find((e) => e.kind === kind) ?? null, kind);
  }

  private select(event: PlacedEvent | null, kind?: EventKind): void {
    this.selected = event;
    const k = event?.kind ?? kind ?? "person";
    this.kind.selectedIndex = KINDS.indexOf(k);
    const count = this.events.filter((e) => e.kind === k).length;
    this.number.replaceChildren(...Array.from({ length: count }, (_, i) => new Option(String(i))));
    if (event) this.number.selectedIndex = event.index;
    this.fields.replaceChildren(event ? fieldTable(describe(this.state.map?.doc.events ?? null, event)) : noEvents());
    this.draw();
  }

  private draw(): void {
    drawEvents(this.view.layer, this.events, this.view.cellSize, this.selected);
  }
}

function noEvents(): HTMLElement {
  const p = document.createElement("p");
  p.className = "note";
  p.textContent = ja.noEvents;
  return p;
}

/** イベント 1 件の値を、ラベルと値の組にする。 */
function describe(events: MapEvents | null, e: PlacedEvent): [string, string][] {
  if (!events) return [];
  const pos: [string, string] = [ja.eventPosition, `${hex(e.x, 4)} ${hex(e.y, 4)}`];
  const f = ja.eventFields;
  switch (e.kind) {
    case "person": {
      const p = events.persons[e.index]!;
      return [
        [f.person.localId, String(p.localId)],
        [f.person.graphicsId, String(p.graphicsId)],
        pos,
        [f.person.elevation, hex(p.elevation, 2)],
        [f.person.movementType, hex(p.movementType, 2)],
        [f.person.movementRange, `${p.movementRangeY}${p.movementRangeX}`],
        [f.person.trainerType, hex(p.trainerType, 2)],
        [f.person.trainerRange, hex(p.trainerRangeOrBerryTree, 4)],
        [f.person.script, `$${hex(p.script & 0x1ffffff, 6)}`],
        [f.person.flag, hex(p.flag, 4)],
      ];
    }
    case "warp": {
      const w = events.warps[e.index]!;
      return [pos, [f.warp.elevation, hex(w.elevation, 2)], [f.warp.warpId, String(w.warpId)], [f.warp.bank, String(w.bank)], [f.warp.map, String(w.map)]];
    }
    case "trap": {
      const t = events.traps[e.index]!;
      return [
        pos,
        [f.trap.elevation, hex(t.elevation, 2)],
        [f.trap.variable, hex(t.variable, 4)],
        [f.trap.value, hex(t.value, 4)],
        [f.trap.script, `$${hex(t.script & 0x1ffffff, 6)}`],
      ];
    }
    case "sign": {
      const s = events.signs[e.index]!;
      const rows: [string, string][] = [pos, [f.sign.elevation, hex(s.elevation, 2)], [f.sign.kind, hex(s.kind, 2)]];
      if (s.content.type === "script") rows.push([f.sign.script, `$${hex(s.content.script & 0x1ffffff, 6)}`]);
      else rows.push([f.sign.item, hex(s.content.item, 4)], [f.sign.hiddenId, hex(s.content.flag, 2)], [f.sign.amount, String(s.content.amount)]);
      return rows;
    }
  }
}
