import {
  ItemNameTable,
  type Command,
  MoveEventCommand,
  SetEventCountsCommand,
  RealignEventLabelsCommand,
  SetEventLabelCommand,
  SetFlyPositionCommand,
  eventsOutsideMap,
  type MapDocument,
  type MapId,
} from "@zigzagumap/core";
import "../../styles/event.css";
import { jaTemplate } from "../../i18n/ja.template";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { jaEventDelete } from "../../i18n/ja.eventDelete";
import { jaWarpMap } from "../../i18n/ja.warpMap";
import { jaTrainer } from "../../i18n/ja.trainer";
import { showContextMenu } from "../ContextMenu";
import { showError } from "../MessageBox";
import { drawEvents, eventAt, placedEvents, type EventOverlay, type PlacedEvent } from "../map/EventLayer";
import { MapView } from "../map/MapView";
import { spriteSourceFor } from "../map/spriteCanvases";
import { EventCommonPanel } from "./EventCommonPanel";
import { EventEditor } from "./EventEditor";
import { EventManagerPanel, type EventCounts } from "./EventManagerPanel";
import { EventMapInput, type RawCell } from "./EventMapInput";
import { EventOffsets, hasAnyEvent, listCount, mapFly, type UiKind } from "./eventModel";
import { FlyPanel } from "./panels/FlyPanel";
import type { PanelHost, ScriptEventKind, UnusedKind } from "./panels/KindPanel";
import { PersonPanel } from "./panels/PersonPanel";
import { SignPanel } from "./panels/SignPanel";
import { TrapPanel } from "./panels/TrapPanel";
import { WarpPanel } from "./panels/WarpPanel";
import { scriptEntry } from "../script/ScriptEntry";
import type { ScriptLabelSource } from "../script/ScriptLabelField";
import type { ScriptFiles } from "../script/ScriptFiles";
import { EventHover } from "./EventHover";
import { eventHoverSource } from "./eventHoverSource";
import { drawWarpWarnings, unusableWarps } from "./warpCheck";
import { ctrlPeek } from "../map/ctrlPeek";
import type { ScriptSummaries } from "./ScriptSummaries";

/** タブの外の機能（App が渡す）。 */
export interface EventTabHost {
  openMap(id: MapId): Promise<void>;
  /** `.s` の読み書きとラベルの一覧。 */
  readonly scriptFiles: ScriptFiles;
  /** イベントを削除する（#220。確認のダイアログを出してから。スクリプトの記述と ROM の範囲も）。 */
  deleteEvent(kind: Exclude<UiKind, "fly">, index: number): void;
  /** 範囲の中で使われていない最小の番号（#227。「未使用を選ぶ」ボタン）。 */
  pickUnused?(kind: UnusedKind): Promise<number | null>;
  /** 「ここにひな形を置く」（#243。マスの位置）。 */
  placeTemplate?(x: number, y: number): void;
  /** ひな形を置けるか（プロジェクトフォルダを開いているとき）。 */
  canPlaceTemplate?(): boolean;
  /** スクリプトの要約（#226。ホバーの吹き出し）。 */
  summaries?(): Promise<ScriptSummaries>;
  /** ワープの行き先のマップを作る（#241。右クリックのメニュー）。 */
  createWarpMap?(index: number): void;
  /** 人のスクリプトのトレーナーを直す窓（#274。右クリックのメニュー）。 */
  editTrainer?(index: number): void;
}

/** スクリプトのラベルの並び（スクリプトタイルは eventscripts の `tile`）。 */
const LABEL_TARGET: Readonly<Record<ScriptEventKind, "person" | "sign" | "tile">> = { person: "person", sign: "sign", trap: "tile" };

/** 看板のスクリプトのポインタ（隠しアイテムなら undefined）。 */
function signScript(sign: { content: { type: string; script?: number } } | undefined): number | undefined {
  return sign?.content.type === "script" ? sign.content.script : undefined;
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
  private readonly noEvents: HTMLElement;
  private readonly common: EventCommonPanel;
  private readonly manager: EventManagerPanel;
  private readonly sorry: HTMLElement;
  /** scripts_MM.json の座標と合わないラベルの知らせ（#204。Bochi などでイベントの順を変えたとき）。 */
  private readonly labelWarn: HTMLElement;
  private readonly panels: { person: PersonPanel; sign: SignPanel; warp: WarpPanel; trap: TrapPanel; fly: FlyPanel };
  private kind: UiKind = "person";
  private index = 0;
  private showCursor = true;
  private placed: PlacedEvent[] = [];
  /** ドラッグで最後に実行した動かすコマンド（離したときにクローンを合わせる。#242）。 */
  private lastDrag: { command: Command; id: MapId; key: string; kind: string } | null = null;
  /** イベントの上にカーソルを止めたときの吹き出し（#226）。 */
  readonly hoverTip: EventHover;
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
      openScript: (kind, index) => this.openScript(kind, index),
      labelSource: (kind, index) => this.labelSource(kind, index),
      goTo: (bank, map, warpId) => void this.goTo(bank, map, warpId),
      unused: (kind) => this.host.pickUnused?.(kind) ?? Promise.resolve(null),
      unusedAvailable: () => state.session?.projectDir != null,
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
    this.labelWarn = document.createElement("div");
    this.labelWarn.className = "event-label-warn";
    this.labelWarn.dataset["autoId"] = "event.labelWarn";
    this.labelWarn.hidden = true;
    const side = document.createElement("div");
    side.className = "event-side";
    side.dataset["autoId"] = "event.panel";
    side.append(this.labelWarn, this.common.element, ...Object.values(this.panels).map((p) => p.element), this.sorry, this.manager.element);
    this.element.append(area, side);

    new EventMapInput(this.view, {
      press: (cell) => this.press(cell),
      drag: (cell) => this.dragTo(cell),
      release: () => this.release(),
      activate: (cell) => this.activate(cell),
      hover: (cell) => this.hover(cell),
      contextMenu: (cell, x, y) => this.contextMenu(cell, x, y),
    });
    this.hoverTip = new EventHover(
      this.view,
      eventHoverSource({
        state,
        placed: () => this.placed,
        summaries: () => host.summaries?.() ?? Promise.reject(new Error("summaries")),
      }),
    );
    state.on("map", () => this.hoverTip.hide());
    state.on("tab", () => this.hoverTip.hide());
    ctrlPeek.on((held) => {
      if (held) this.hoverTip.hide();
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
    this.showLabelWarn();
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
    // ワープできないブロックの上のワープに印（#240）
    if (!sprites && this.state.map) drawWarpWarnings(this.view.layer, this.warpWarnings().map((i) => this.state.map!.doc.events!.warps[i]!), this.view.cellSize);
  }

  /** マスのブロックを拾う（Ctrl＋右クリック。マップタブで描くブロックになる。#238）。 */
  private pickBlock(cell: RawCell): void {
    const doc = this.state.map?.doc;
    if (!doc || cell.x < 0 || cell.y < 0 || cell.x >= doc.width || cell.y >= doc.height) return;
    const block = doc.grid.getBlock(cell.x, cell.y);
    this.state.selectBlock(block);
    this.state.setStatus(ja.statusBlock(block));
  }

  /** ワープできないブロックの上にあるワープの番号（#240）。 */
  warpWarnings(): number[] {
    const map = this.state.map;
    return map ? unusableWarps(map.doc, map.tiles) : [];
  }

  /**
   * マップ&イベント画像に重ねるもの。AdvanceMap と同じく、イベントタブに描いている印（フライトポジションを含む）と、
   * カーソルの表示がオンなら選択中のイベントの赤い枠。
   */
  exportOverlay(): EventOverlay {
    return { events: this.placed, selected: this.showCursor ? this.selectedPlaced() : null };
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
    // Ctrl を押している間はイベントをつかまない（重ね描きを隠して下のブロックを見るため。#238）
    const hit = ctrlPeek.held ? null : eventAt(this.placed, cell.x, cell.y);
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
    if (this.editor.run(command, d.key)) this.lastDrag = { command, id, key: d.key, kind: d.kind };
  }

  release(): void {
    this.drag = null;
    const last = this.lastDrag;
    this.lastDrag = null;
    // 人を動かしたら、隣のマップのクローンを合わせる（#242。動かしたのと同じ 1 回の操作にまとめる）
    if (last && last.kind === "person") {
      void this.editor.syncClones(last.command, last.id).finally(() => this.editor.endSession());
      return;
    }
    this.editor.endSession();
  }

  /** ダブルクリック: ワープは「マップの移動」、看板・スクリプト・人は「スクリプトを開く」（入口が使えるときだけ）。 */
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
        return this.openScript("trap", hit.index);
      case "sign": {
        // 隠しアイテムの看板（スクリプトを持たない）は開かない
        if (events.signs[hit.index]!.content.type === "script") this.openScript("sign", hit.index);
        return;
      }
      case "person":
        return this.openScript("person", hit.index);
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

  // ---- スクリプト ----

  /** 「スクリプトを開く」とダブルクリック: ラベルが付いていればエディタのその行、無ければ ROM のスクリプトを読み取り専用で。 */
  openScript(kind: ScriptEventKind, index: number): void {
    const map = this.state.map;
    const events = map?.doc.events;
    if (!map || !events) return;
    const pointer = kind === "person" ? events.persons[index]?.script : kind === "trap" ? events.traps[index]?.script : signScript(events.signs[index]);
    scriptEntry.open({ map: map.id, kind, index }, pointer ?? null);
  }

  /** scripts_MM.json に書いた座標と、今のイベントの座標が合わないラベルを知らせる（付け直すボタンつき）。 */
  private showLabelWarn(): void {
    const session = this.state.session;
    const id = this.state.map?.id;
    const positions = id && session?.projectDir ? session.eventPositions(id.bank, id.map) : null;
    const found = id && positions ? session!.labels.store.mismatches(id.bank, id.map, positions) : [];
    this.labelWarn.hidden = found.length === 0;
    if (found.length === 0) return;
    const text = document.createElement("span");
    text.textContent = ja.event.labelMismatch(found.length, found.filter((x) => x.candidate !== null).length);
    text.title = found.map((x) => ja.event.labelMismatchItem(x.label, x.target, x.index, x.expected.x, x.expected.y, x.candidate)).join(String.fromCharCode(10));
    const fix = document.createElement("button");
    fix.type = "button";
    fix.textContent = ja.event.labelRealign;
    fix.dataset["autoId"] = "event.labelRealign";
    fix.disabled = !found.some((x) => x.candidate !== null);
    fix.addEventListener("click", () => this.editor.run(new RealignEventLabelsCommand({ ...id! })));
    this.labelWarn.replaceChildren(text, fix);
  }

  /** スクリプトのラベルの欄の中身。 */
  private labelSource(kind: ScriptEventKind, index: () => number | null): ScriptLabelSource {
    const files = this.host.scriptFiles;
    const target = LABEL_TARGET[kind];
    return {
      available: () => !!this.state.session?.projectDir,
      current: () => {
        const id = this.state.map?.id;
        const i = index();
        if (!id || i === null) return null;
        return this.state.session?.labels.store.label(id.bank, id.map, target, i)?.label ?? null;
      },
      candidates: async () => {
        const id = this.state.map?.id;
        const resolved = id ? this.state.session?.scriptsTable.document.resolve(id.bank, id.map) : null;
        return resolved ? files.labelsOf(resolved.script) : [];
      },
      commit: (label) => {
        const id = this.state.map?.id;
        const i = index();
        if (!id || i === null) return;
        this.editor.run(new SetEventLabelCommand({ ...id, target, index: i, label }));
      },
      onCandidatesChanged: (listener) => files.onChange(listener),
    };
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

  /**
   * 「イベントの削除」（ボタン・右クリックの「イベントを削除」・Delete キー）: 選んだイベントを消す（#220）。
   * 確認のダイアログを出し、スクリプトの記述（`.s`・`.string`）か ROM の埋める範囲も一緒に消す。
   * 後ろが前に詰まり、番号はそのまま（末尾なら 1 つ前）。
   */
  removeSelected(): void {
    const id = this.state.map?.id;
    if (!id || this.kind === "fly" || this.count() === 0) return;
    this.editor.endSession();
    this.host.deleteEvent(this.kind, this.index);
  }

  /** 右クリック: イベントの上なら選んで、「イベントを削除」と「スクリプトを開く」のメニューを出す。 */
  contextMenu(cell: RawCell, x: number, y: number): void {
    // Ctrl を押している間はイベントを無いものとして、下のブロックを拾う（#238）
    if (ctrlPeek.held) return this.pickBlock(cell);
    const hit = eventAt(this.placed, cell.x, cell.y);
    // 「ここにひな形を置く」（#243）。プロジェクトフォルダを開いているときだけ、イベントの無いマスでも出す
    const templates = this.host.canPlaceTemplate?.()
      ? [{ id: "placeTemplate", label: jaTemplate.menuPlace, run: () => this.host.placeTemplate?.(cell.x, cell.y) }]
      : [];
    if (!hit) {
      if (templates.length > 0) showContextMenu(x, y, templates);
      return;
    }
    this.select(hit.kind, hit.kind === "fly" ? 0 : hit.index);
    const kind = hit.kind;
    const index = hit.index;
    const scriptKind = kind === "person" || kind === "sign" || kind === "trap" ? kind : null;
    const signItem = kind === "sign" && this.state.map?.doc.events?.signs[index]?.content.type !== "script";
    showContextMenu(x, y, [
      { id: "delete", label: jaEventDelete.menuDelete, enabled: kind !== "fly", run: () => this.removeSelected() },
      {
        id: "openScript",
        label: jaEventDelete.menuOpenScript,
        enabled: scriptKind !== null && !signItem,
        run: () => scriptKind && this.openScript(scriptKind, index),
      },
      // 「行き先のマップを作る」（#241。ワープだけ）
      ...(kind === "warp" && this.host.createWarpMap ? [{ id: "createWarpMap", label: jaWarpMap.menu, run: () => this.host.createWarpMap?.(index) }] : []),
      // 「トレーナーを編集」（#274。人だけ。trainers.json を書くのでプロジェクトフォルダがあるときだけ。クローンは参照先を直す）
      ...(kind === "person" && this.host.editTrainer && this.state.session?.projectDir && this.state.map?.doc.events?.persons[index]?.kind !== 1
        ? [{ id: "editTrainer", label: jaTrainer.menuEdit, run: () => this.host.editTrainer?.(index) }]
        : []),
      ...templates,
    ]);
  }

  /** イベントマネージャーの「設定」。 */
  private setCounts(counts: EventCounts): void {
    const id = this.state.map?.id;
    if (!id) return;
    // 人の数が変われば、隣のマップのクローンも合わせる（#242）
    if (this.editor.runWithClones(new SetEventCountsCommand({ ...id, ...counts }), id)) this.manager.show(this.counts(), true);
  }
}
