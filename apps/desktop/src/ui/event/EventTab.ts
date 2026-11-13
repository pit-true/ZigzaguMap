import {
  ItemNameTable,
  MoveEventCommand,
  RemoveEventCommand,
  SetEventCountsCommand,
  SetFlyPositionCommand,
  eventsOutsideMap,
  type MapDocument,
  type MapId,
} from "@zigzagumap/core";
import "../../styles/event.css";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { showError } from "../MessageBox";
import { drawEvents, eventAt, placedEvents, type PlacedEvent } from "../map/EventLayer";
import { MapView } from "../map/MapView";
import { spriteSourceFor } from "../map/spriteCanvases";
import { EventCommonPanel } from "./EventCommonPanel";
import { EventEditor } from "./EventEditor";
import { EventManagerPanel, type EventCounts } from "./EventManagerPanel";
import { EventMapInput, type RawCell } from "./EventMapInput";
import { EventOffsets, hasAnyEvent, listCount, mapFly, type UiKind } from "./eventModel";
import { FlyPanel } from "./panels/FlyPanel";
import type { PanelHost } from "./panels/KindPanel";
import { PersonPanel } from "./panels/PersonPanel";
import { SignPanel } from "./panels/SignPanel";
import { TrapPanel } from "./panels/TrapPanel";
import { WarpPanel } from "./panels/WarpPanel";
import { ScriptLauncher } from "./ScriptLauncher";

/** タブの外の機能（App が渡す）。 */
export interface EventTabHost {
  openMap(id: MapId): Promise<void>;
}

/**
 * イベントタブ（AdvanceMap の「イベントの設定」）。左にマップと文字の箱、右に共通部・種別ごとのパネル・イベントマネージャー。
 * 編集はすべて core のコマンドを CommandBus で実行する（アンドゥ・リドゥできる）。
 * 種別の選択はマップを切り替えても保ち、番号は 0 に戻す（AdvanceMap と同じ）。
 */
export class EventTab {
  readonly element: HTMLElement;
  readonly view: MapView;
  readonly editor: EventEditor;
  readonly launcher: ScriptLauncher;
  private readonly noEvents: HTMLElement;
  private readonly common: EventCommonPanel;
  private readonly manager: EventManagerPanel;
  private readonly sorry: HTMLElement;
  private readonly panels: { person: PersonPanel; sign: SignPanel; warp: WarpPanel; trap: TrapPanel; fly: FlyPanel };
  private kind: UiKind = "person";
  private index = 0;
  private showCursor = true;
  private placed: PlacedEvent[] = [];
  private offsets: EventOffsets | null = null;
  private itemsLoaded = false;
  private unsubscribe: (() => void) | null = null;
  private drag: { kind: UiKind; index: number; key: string } | null = null;
  private dragCount = 0;

  constructor(
    private readonly state: EditorState,
    private readonly host: EventTabHost,
  ) {
    this.editor = new EventEditor(state);
    this.launcher = new ScriptLauncher(state.settings, () => state.session?.romPath ?? null);
    this.element = document.createElement("div");
    this.element.className = "event-tab";
    this.view = new MapView("event-tab-view");
    this.noEvents = document.createElement("div");
    this.noEvents.className = "event-none-label";
    this.noEvents.textContent = ja.event.noEventsInMap;
    this.noEvents.hidden = true;
    const area = document.createElement("div");
    area.className = "event-map-area";
    area.append(this.view.element, this.noEvents);

    const panelHost: PanelHost = {
      editor: this.editor,
      mapId: () => state.map?.id ?? null,
      openScript: (pointer) => void this.launcher.open(pointer),
      goTo: (bank, map, warpId) => void this.goTo(bank, map, warpId),
    };
    this.panels = {
      person: new PersonPanel(panelHost),
      sign: new SignPanel(panelHost),
      warp: new WarpPanel(panelHost),
      trap: new TrapPanel(panelHost),
      fly: new FlyPanel(panelHost),
    };
    this.common = new EventCommonPanel({
      kind: (kind) => this.select(kind, 0),
      number: (index) => this.select(this.kind, index),
      cursor: (visible) => {
        this.showCursor = visible;
        this.draw();
      },
      remove: () => this.removeSelected(),
    });
    this.sorry = document.createElement("p");
    this.sorry.className = "event-sorry";
    this.sorry.textContent = ja.event.none;
    this.manager = new EventManagerPanel((counts) => this.setCounts(counts));
    const side = document.createElement("div");
    side.className = "event-side";
    side.dataset["auto"] = "event.panel";
    side.append(this.common.element, ...Object.values(this.panels).map((p) => p.element), this.sorry, this.manager.element);
    this.element.append(area, side);

    new EventMapInput(this.view, {
      press: (cell) => this.press(cell),
      drag: (cell) => this.dragTo(cell),
      release: () => this.release(),
      activate: (cell) => this.activate(cell),
      hover: (cell) => this.hover(cell),
    });

    state.on("session", () => this.attachSession());
    state.on("map", () => {
      this.index = 0;
      this.view.setImage(state.mapImage);
      this.refresh(true);
    });
    state.on("cells", () => this.view.sync());
    state.on("view", () => this.configure());
    state.on("tab", () => {
      if (state.tab === "event") this.showNote();
    });
    this.configure();
    this.refresh(true);
  }

  // ---- 選択 ----

  /** 選んでいる種別と番号。 */
  get selection(): { kind: UiKind; index: number } {
    return { kind: this.kind, index: this.index };
  }

  /** 種別と番号を選ぶ（番号は個数の範囲に収める）。 */
  select(kind: UiKind, index: number): void {
    this.kind = kind;
    this.index = index;
    this.editor.endSession();
    this.refresh();
  }

  /** 選んだ種別の個数（フライトポジションは 0 か 1）。 */
  count(kind: UiKind = this.kind): number {
    const doc = this.state.map?.doc;
    if (!doc) return 0;
    if (kind === "fly") return this.fly() ? 1 : 0;
    return listCount(doc, kind);
  }

  /** 4 種の個数。 */
  counts(): EventCounts {
    return { persons: this.count("person"), signs: this.count("sign"), warps: this.count("warp"), traps: this.count("trap") };
  }

  // ---- 表示 ----

  private attachSession(): void {
    const session = this.state.session;
    this.unsubscribe?.();
    this.unsubscribe = session?.bus.subscribe(() => this.refresh()) ?? null;
    this.editor.attach(session?.bus ?? null);
    this.offsets = session ? new EventOffsets(session.project) : null;
    this.itemsLoaded = false;
  }

  private configure(): void {
    const s = this.state.settings.data;
    this.view.configure(s.zoomEvent ? 2 : 1, s.grid);
    this.draw();
  }

  private fly(): ReturnType<typeof mapFly> {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return null;
    return mapFly(session.project.editorContext().flyPositions, map.id);
  }

  /** パネルとマップの描画を、いまのマップと選択に合わせる。 */
  private refresh(resetManager = false): void {
    const doc = this.state.map?.doc ?? null;
    const count = this.count();
    if (this.index >= count) this.index = Math.max(0, count - 1);
    if (this.index < 0) this.index = 0;
    this.common.show(this.kind, this.index, count);
    for (const [kind, panel] of Object.entries(this.panels)) panel.element.hidden = kind !== this.kind || count === 0;
    this.sorry.hidden = count > 0;
    if (doc && count > 0) this.showPanel(doc);
    this.manager.show(this.counts(), resetManager);
    const hasEvents = !!doc && hasAnyEvent(doc);
    this.view.element.hidden = !!doc && !hasEvents;
    this.noEvents.hidden = !doc || hasEvents;
    const fly = this.fly();
    this.placed = placedEvents(doc?.events ?? null, fly);
    this.draw();
    if (this.state.tab === "event") this.showNote();
  }

  private showPanel(doc: MapDocument): void {
    const i = this.index;
    switch (this.kind) {
      case "person":
        return this.panels.person.show(doc.events!.persons[i]!, i);
      case "sign":
        this.loadItems();
        return this.panels.sign.show(doc.events!.signs[i]!, i);
      case "warp":
        return this.panels.warp.show(doc.events!.warps[i]!, i);
      case "trap":
        return this.panels.trap.show(doc.events!.traps[i]!, i);
      case "fly": {
        const fly = this.fly();
        if (fly) this.panels.fly.show(fly.entry, fly.index);
        return;
      }
    }
  }

  /** 看板のアイテム ID の選択肢（初めて看板を出すときに ROM の道具名を読む）。 */
  private loadItems(): void {
    const session = this.state.session;
    if (this.itemsLoaded || !session) return;
    this.itemsLoaded = true;
    const p = session.project;
    try {
      this.panels.sign.setItems(ItemNameTable.read(p.rom, p.game.offsets.itemTablePointer, p.game.offsets.itemCount, p.textCodec).names);
    } catch {
      this.panels.sign.setItems([]);
    }
  }

  private draw(): void {
    const selected = this.showCursor ? this.selectedPlaced() : null;
    const sprites = this.state.settings.data.showObjects ? spriteSourceFor(this.state.session) : null;
    drawEvents(this.view.layer, this.placed, this.view.cellSize, selected, sprites);
  }

  private selectedPlaced(): PlacedEvent | null {
    const fly = this.kind === "fly";
    return this.placed.find((e) => e.kind === this.kind && (fly || e.index === this.index)) ?? null;
  }

  /** ステータスバー右欄のノート。 */
  private showNote(): void {
    const doc = this.state.map?.doc;
    if (!doc) return;
    if (!hasAnyEvent(doc)) return this.state.setStatusRight(ja.event.noteNoEvents);
    const fly = this.fly();
    const outside = eventsOutsideMap(doc).length > 0 || (!!fly && (fly.x >= doc.width || fly.y >= doc.height));
    this.state.setStatusRight(outside ? ja.event.noteOutside : ja.event.noteOk);
  }

  // ---- マップ上の操作 ----

  /** マスを押した。イベントがあれば選んでつかむ。 */
  press(cell: RawCell): boolean {
    const hit = eventAt(this.placed, cell.x, cell.y);
    if (!hit) {
      this.hover(cell);
      return false;
    }
    this.select(hit.kind, hit.kind === "fly" ? 0 : hit.index);
    this.drag = { kind: hit.kind, index: hit.index, key: `drag.${++this.dragCount}` };
    return true;
  }

  /** つかんだイベントを動かす（マップの外へも動かせる。負の座標は 16 ビットで回る）。 */
  dragTo(cell: RawCell): void {
    const d = this.drag;
    const id = this.state.map?.id;
    if (!d || !id) return;
    const x = cell.x & 0xffff;
    const y = cell.y & 0xffff;
    const command =
      d.kind === "fly" ? new SetFlyPositionCommand({ index: d.index, fields: { x, y } }) : new MoveEventCommand({ ...id, kind: d.kind, index: d.index, x, y });
    this.editor.run(command, d.key);
  }

  release(): void {
    this.drag = null;
    this.editor.endSession();
  }

  /** ダブルクリック: ワープは「マップの移動」、看板・スクリプト・人は「スクリプトを開く」。 */
  activate(cell: RawCell): void {
    const hit = eventAt(this.placed, cell.x, cell.y);
    const events = this.state.map?.doc.events;
    if (!hit || !events) return;
    switch (hit.kind) {
      case "warp": {
        const w = events.warps[hit.index]!;
        return void this.goTo(w.bank, w.map, w.warpId);
      }
      case "trap":
        return void this.launcher.open(events.traps[hit.index]!.script);
      case "sign": {
        const s = events.signs[hit.index]!;
        if (s.content.type === "script") void this.launcher.open(s.content.script);
        return;
      }
      case "person": {
        const p = events.persons[hit.index]!;
        if (p.script !== 0) void this.launcher.open(p.script);
        return;
      }
      case "fly":
        return;
    }
  }

  /** マウスを載せた: ステータスバーに座標・イベント・エントリーの ROM オフセットを出す。 */
  hover(cell: RawCell | null): void {
    if (!cell || !this.state.map) return;
    const hit = eventAt(this.placed, cell.x, cell.y);
    if (!hit) return this.state.setStatus(ja.event.status(cell.x, cell.y, ja.event.noEventAtCell, null));
    const offset = hit.kind === "fly" ? (this.offsets?.fly(hit.index) ?? null) : (this.offsets?.entry(this.state.map.id, hit.kind, hit.index) ?? null);
    this.state.setStatus(ja.event.status(cell.x, cell.y, `${ja.event.kindNames[hit.kind]}${hit.kind === "fly" ? 0 : hit.index}`, offset));
  }

  // ---- ボタン ----

  /** 「マップの移動」: 行き先のマップを開き、行き先のワープを選ぶ。無いマップならエラー。 */
  async goTo(bank: number, map: number, warpId: number): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    const id = { bank, map };
    if (!session.catalog.has(id)) return void (await showError(ja.event.mapNotFound));
    await this.host.openMap(id);
    const doc = this.state.map?.doc;
    if (!doc || this.state.map!.id.bank !== bank || this.state.map!.id.map !== map) return;
    this.select("warp", warpId < listCount(doc, "warp") ? warpId : 0);
  }

  /** 「イベントの削除」: 選んだイベントを消す（後ろが前に詰まり、番号はそのまま。末尾なら 1 つ前）。 */
  removeSelected(): void {
    const id = this.state.map?.id;
    if (!id || this.kind === "fly" || this.count() === 0) return;
    this.editor.run(new RemoveEventCommand({ ...id, kind: this.kind, index: this.index }));
  }

  /** イベントマネージャーの「設定」。 */
  private setCounts(counts: EventCounts): void {
    const id = this.state.map?.id;
    if (!id) return;
    if (this.editor.run(new SetEventCountsCommand({ ...id, ...counts }))) this.manager.show(this.counts(), true);
  }
}
