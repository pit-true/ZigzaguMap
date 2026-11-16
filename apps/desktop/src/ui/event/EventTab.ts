import {
  ItemNameTable,
  type Command,
  MoveEventCommand,
  SetEventCountsCommand,
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
import { drawEvents, drawSelectRect, drawSelectionFrames, eventAt, placedEvents, type EventOverlay, type PlacedEvent } from "../map/EventLayer";
import { MapView } from "../map/MapView";
import { spriteSourceFor } from "../map/spriteCanvases";
import { personGraphicsId } from "../map/cloneLook";
import { EventCommonPanel } from "./EventCommonPanel";
import { EventEditor } from "./EventEditor";
import { EventManagerPanel, type EventCounts } from "./EventManagerPanel";
import { EventMapInput, type PressInfo, type RawCell } from "./EventMapInput";
import { EventOffsets, hasAnyEvent, listCount, mapFly, type UiKind } from "./eventModel";
import { FlyPanel } from "./panels/FlyPanel";
import type { PanelHost, ScriptEventKind, UnusedKind } from "./panels/KindPanel";
import { PersonPanel } from "./panels/PersonPanel";
import { SignPanel } from "./panels/SignPanel";
import { TrapPanel } from "./panels/TrapPanel";
import { WarpPanel } from "./panels/WarpPanel";
import { scriptEntry } from "../script/ScriptEntry";
import type { ScriptFiles } from "../script/ScriptFiles";
import { EventHover } from "./EventHover";
import { eventHoverSource } from "./eventHoverSource";
import { drawWarpWarnings, unusableWarps } from "./warpCheck";
import { ctrlPeek } from "../map/ctrlPeek";
import type { ScriptSummaries } from "./ScriptSummaries";
import { EventQuickAdd } from "./EventQuickAdd";
import { tabZoom } from "../../app/mapZoom";
import { visibleEvents } from "./eventVisibility";
import { EventScriptLabels } from "./EventScriptLabels";
import { EventSelection, eventsInRect, type EventRef } from "./EventSelection";
import { duplicatePlan, groupDragStart, groupMoveCommand, type GroupDragStart } from "./EventMultiEdit";
import { jaEventMulti } from "../../i18n/ja.eventMulti";
import { jaEventLimit } from "../../i18n/ja.eventLimit";
import { jaPlayback } from "../../i18n/ja.playback";
import { Ruler } from "./RulerLayer";

/** タブの外の機能（App が渡す）。 */
export interface EventTabHost {
  playScript?(kind: "person" | "sign" | "trap", index: number): void;
  openMap(id: MapId): Promise<void>;
  /** `.s` の読み書きとラベルの一覧。 */
  readonly scriptFiles: ScriptFiles;
  /** イベントを削除する（#220。確認のダイアログを出してから。スクリプトの記述と ROM の範囲も）。 */
  deleteEvent(kind: Exclude<UiKind, "fly">, index: number): void;
  /** いくつかのイベントをまとめて削除する（#399。確認のダイアログは 1 回）。 */
  deleteEvents?(list: readonly EventRef[]): void;
  /** 範囲の中で使われていない最小の番号（#227。「未使用を選ぶ」ボタン）。 */
  pickUnused?(kind: UnusedKind): Promise<number | null>;
  /** 「ここにひな形を置く」（#243。マスの位置）。 */
  placeTemplate?(x: number, y: number): void;
  /** 「ここに仮の主人公を置く」（#457。保存しない）。 */
  placePlayer?(x: number, y: number): void;
  /** ひな形を置けるか（プロジェクトフォルダを開いているとき）。 */
  canPlaceTemplate?(): boolean;
  /** スクリプトの要約（#226。ホバーの吹き出し）。 */
  summaries?(): Promise<ScriptSummaries>;
  /** ワープの行き先のマップを作る（#241。右クリックのメニュー）。 */
  createWarpMap?(index: number): void;
  /** 人のスクリプトのトレーナーを直す窓（#274。右クリックのメニュー）。 */
  editTrainer?(index: number): void;
  /** 「ここに落とし物を追加」（#304。ひな形の落とし物と同じ処理）。 */
  placeItemBall?(x: number, y: number): void;
}

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
  /** スクリプトのラベルの欄と、scripts_MM.json の座標と合わないラベルの知らせ（#204）。 */
  private readonly labels: EventScriptLabels;
  private readonly panels: { person: PersonPanel; sign: SignPanel; warp: WarpPanel; trap: TrapPanel; fly: FlyPanel };
  private kind: UiKind = "person";
  private index = 0;
  private showCursor = true;
  private placed: PlacedEvent[] = [];
  /** クローンの元のマップを読み終えたら、元の人の見た目で描き直す（#298。同じ関数を渡して 1 回だけ呼ばせる）。 */
  private readonly onCloneOrigin = (): void => {
    this.placed = this.placeEvents();
    this.draw();
  };
  /** ドラッグで最後に実行した動かすコマンド（離したときにクローンを合わせる。#242）。 */
  private lastDrag: { command: Command; id: MapId; key: string; kind: string } | null = null;
  /** イベントの上にカーソルを止めたときの吹き出し（#226）。 */
  readonly hoverTip: EventHover;
  /** 画面のマスが隣のマップの帯の上か（帯の上のクローンの吹き出し。#345。MapExtras が入れる）。 */
  onBand: ((cell: RawCell) => boolean) | null = null;
  private offsets: EventOffsets | null = null;
  private itemsLoaded = false;
  private unsubscribe: (() => void) | null = null;
  /** つかんだイベント。`group` があれば、選んでいるものをまとめて動かす（#399）。 */
  private drag: { kind: UiKind; index: number; key: string; start: RawCell; group: GroupDragStart | null } | null = null;
  private dragCount = 0;
  /** 複数選択（#399）。1 つだけ選んでいるときは空。 */
  readonly multi = new EventSelection();
  /** Shift＋ドラッグの矩形（#399。ドラッグの間だけ）。 */
  private rect: { from: RawCell; to: RawCell } | null = null;
  /** Shift＋右ドラッグのルーラー（#400。ドラッグの間だけ）。 */
  readonly ruler = new Ruler();
  /** ルーラーを伸ばして離した直後の右クリックのメニューを出さない（#400）。 */
  private skipMenu = false;
  /** 右クリックの「ここに○○を追加」（#304）。 */
  readonly quickAdd: EventQuickAdd;
  private readonly selectListeners = new Set<() => void>();

  constructor(
    private readonly state: EditorState,
    private readonly host: EventTabHost,
  ) {
    this.editor = new EventEditor(state);
    this.labels = new EventScriptLabels(state, this.editor, host.scriptFiles);
    this.quickAdd = new EventQuickAdd(state, this.editor, {
      select: (kind, index) => this.select(kind, index),
      itemBall: () => (host.placeItemBall && host.canPlaceTemplate?.() ? (x, y) => host.placeItemBall?.(x, y) : null),
    });
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
      labelSource: (kind, index) => this.labels.source(kind, index),
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
    const side = document.createElement("div");
    side.className = "event-side";
    side.dataset["autoId"] = "event.panel";
    side.append(this.labels.warn, this.common.element, ...Object.values(this.panels).map((p) => p.element), this.sorry, this.manager.element);
    this.element.append(area, side);

    new EventMapInput(this.view, {
      press: (cell, info) => this.press(cell, info),
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
        onBand: (cell) => this.onBand?.(cell) ?? false,
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
      this.multi.clear();
      this.view.setImage(state.mapImage);
      this.refresh(true);
    });
    state.on("cells", () => this.view.sync());
    state.on("view", () => this.configure());
    // イベントの濃さ（#304。濃さの窓のスライダーを動かしている間も）
    state.on("opacity", () => this.draw());
    this.view.wakeListeners.push(() => this.draw());
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
    this.multi.clear();
    this.focus(kind, index);
  }

  /** 欄に出すイベントを変える（複数選択はそのまま。#399）。 */
  private focus(kind: UiKind, index: number): void {
    this.kind = kind;
    this.index = index;
    this.editor.endSession();
    this.refresh();
    for (const l of this.selectListeners) l();
  }

  /**
   * 選んでいるイベント（#399。複数選択なら全部、そうでなければ欄に出している 1 つ。イベントが無ければ空）。
   */
  selectedEvents(): EventRef[] {
    if (this.multi.multiple) return [...this.multi.list()];
    return this.count() > 0 ? [{ kind: this.kind, index: this.kind === "fly" ? (this.fly()?.index ?? 0) : this.index }] : [];
  }

  /** いくつかを選ぶ（自動操作用。1 つなら `select` と同じ）。 */
  selectMany(refs: readonly EventRef[]): void {
    const last = refs.at(-1);
    if (!last) return;
    this.multi.set(refs);
    this.focus(last.kind, last.kind === "fly" ? 0 : last.index);
  }

  /** 選ぶイベントが変わったときに呼ぶ関数を足す（ポインタ一覧の行の連動など。#307）。 */
  onSelect(listener: () => void): void {
    this.selectListeners.add(listener);
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
    this.view.configure(tabZoom(s, "event"), s.grid);
    // 表示メニューで隠す種類が変わったかもしれない（#304）
    this.placed = this.placeEvents();
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
    // 消した・取り消したイベントは複数選択から外す（#399）
    this.multi.prune((r) => r.index < this.count(r.kind) || (r.kind === "fly" && this.count("fly") > 0));
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
    this.placed = this.placeEvents();
    this.labels.showWarn();
    this.draw();
    if (this.state.tab === "event") this.showNote();
  }

  /**
   * 表示中のマップのイベントを印の並びにする（クローンは元の人の画像番号で。#298）。
   * 表示メニューで隠した種類は除く（隠したものは描かず、クリック・ホバーでも選ばない。#304）。
   */
  private placeEvents(): PlacedEvent[] {
    const session = this.state.session;
    const all = placedEvents(this.state.map?.doc.events ?? null, this.fly(), (p) => personGraphicsId(session, p, this.onCloneOrigin));
    return visibleEvents(all, this.state.settings.data.hiddenEventKinds);
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
    // 隠れている間は描かない（出たときに描き直す。Phase4 #318）
    if (this.view.dormant) return;
    const selected = this.showCursor ? this.selectedPlaced() : null;
    // 人物を動かしている間（#471）は、動く絵を別の Canvas に描くので、ここでは元の位置の箱だけ描く
    const sprites = this.state.settings.data.showObjects && !this.state.movingPersons ? spriteSourceFor(this.state.session, this.state.map?.doc.header.mapType) : null;
    drawEvents(this.view.layer, this.placed, this.view.cellSize, selected, sprites, this.state.settings.data.eventOpacity);
    // 複数選択の枠と、Shift＋ドラッグの矩形（#399）
    if (this.showCursor && this.multi.multiple) drawSelectionFrames(this.view.layer, this.multi.placed(this.placed).filter((p) => p !== selected), this.view.cellSize);
    if (this.rect) drawSelectRect(this.view.layer, this.rect.from, this.rect.to, this.view.cellSize);
    this.ruler.draw(this.view.layer, this.view.cellSize);
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

  /**
   * マスを押した。イベントがあれば選んでつかむ。
   * Shift＋左（#399）: イベントの上なら選びに足す・外す、空いた所なら矩形の選択を始める。
   * 複数選択の中のイベントをつかむと、選んでいるものをまとめて動かす。
   */
  press(cell: RawCell, info: PressInfo = { button: 0, shift: false }): boolean {
    this.skipMenu = false;
    // Ctrl を押している間はイベントをつかまない（重ね描きを隠して下のブロックを見るため。#238）
    const hit = ctrlPeek.held ? null : eventAt(this.placed, cell.x, cell.y);
    if (info.shift && info.button === 0 && !ctrlPeek.held) return this.shiftPress(cell, hit);
    // Shift＋右ドラッグはルーラー（#400。イベントはつかまない）
    if (info.shift && info.button === 2 && !ctrlPeek.held) {
      this.ruler.start(cell);
      this.showRuler();
      return true;
    }
    if (!hit) {
      // 空いた所を押したら複数選択をやめる（欄のイベントはそのまま）
      if (this.multi.multiple) {
        this.multi.clear();
        this.draw();
      }
      this.hover(cell);
      return false;
    }
    const ref = { kind: hit.kind, index: hit.index };
    const group = this.multi.multiple && this.multi.has(ref) ? groupDragStart(this.multi.list(), this.placed) : null;
    if (group) this.focus(hit.kind, hit.kind === "fly" ? 0 : hit.index);
    else this.select(hit.kind, hit.kind === "fly" ? 0 : hit.index);
    this.drag = { kind: hit.kind, index: hit.index, key: `drag.${++this.dragCount}`, start: cell, group };
    return true;
  }

  /** Shift＋左を押した（#399）。 */
  private shiftPress(cell: RawCell, hit: PlacedEvent | null): boolean {
    if (!hit) {
      this.rect = { from: cell, to: cell };
      this.draw();
      return true;
    }
    const primary = this.selectedEvents()[0] ?? null;
    const next = this.multi.toggle({ kind: hit.kind, index: hit.index }, primary);
    if (next) this.focus(next.kind, next.kind === "fly" ? 0 : next.index);
    else this.draw();
    if (this.multi.multiple) this.state.setStatus(jaEventMulti.selected(this.multi.list().length));
    return false;
  }

  /** つかんだイベントを動かす（マップの外へも動かせる。負の座標は 16 ビットで回る）。 */
  dragTo(cell: RawCell): void {
    if (this.ruler.active) {
      this.ruler.move(cell);
      return this.showRuler();
    }
    if (this.rect) {
      this.rect = { from: this.rect.from, to: cell };
      return this.draw();
    }
    const d = this.drag;
    const map = this.state.map;
    if (!d || !map) return;
    const id = map.id;
    if (d.group) {
      // まとめて動かす（#399。マップの中のものはマップの外へ出さない。1 回の元に戻すで全部戻る）
      const command = groupMoveCommand(id, map.doc, d.group, cell.x - d.start.x, cell.y - d.start.y);
      const person = d.group.items.some((i) => i.ref.kind === "person");
      if (command && this.editor.run(command, d.key)) this.lastDrag = { command, id, key: d.key, kind: person ? "person" : d.kind };
      return;
    }
    const x = cell.x & 0xffff;
    const y = cell.y & 0xffff;
    const command =
      d.kind === "fly" ? new SetFlyPositionCommand({ index: d.index, fields: { x, y } }) : new MoveEventCommand({ ...id, kind: d.kind, index: d.index, x, y });
    if (this.editor.run(command, d.key)) this.lastDrag = { command, id, key: d.key, kind: d.kind };
  }

  release(): void {
    if (this.ruler.active) {
      this.skipMenu = this.ruler.stop();
      return this.draw();
    }
    if (this.rect) return this.finishRect();
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

  /** ルーラーの距離をステータスバーに出して描き直す（#400）。 */
  private showRuler(): void {
    const d = this.ruler.distance();
    if (d) this.state.setStatus(jaEventLimit.ruler(d.dx, d.dy));
    this.draw();
  }

  /** Shift＋ドラッグの矩形を離した: 中のイベントを選びに足す（#399）。 */
  private finishRect(): void {
    const r = this.rect!;
    this.rect = null;
    const primary = this.selectedEvents()[0] ?? null;
    const next = this.multi.addAll(eventsInRect(this.placed, r.from, r.to), primary);
    if (next) this.focus(next.kind, next.kind === "fly" ? 0 : next.index);
    else this.draw();
    if (this.multi.multiple) this.state.setStatus(jaEventMulti.selected(this.multi.list().length));
  }

  /**
   * 選んでいるイベントを複製する（#399。Ctrl+D・右クリックの「複製」）。1 マス右下（ふさがっていれば近くの空いたマス）に置き、
   * 番号は種類ごとの末尾に足す。写しを選ぶ。1 回の元に戻すで全部消える。
   */
  duplicateSelected(): boolean {
    const map = this.state.map;
    if (!map) return false;
    const plan = duplicatePlan(map.id, map.doc, this.selectedEvents(), this.placed);
    if (!plan) {
      this.state.setStatus(jaEventMulti.nothingToDuplicate, undefined, true);
      return false;
    }
    this.editor.endSession();
    // 人を写したら、隣のマップのクローンも合わせる（#242）
    const ok = plan.person ? this.editor.runWithClones(plan.command, map.id) : this.editor.run(plan.command);
    this.editor.endSession();
    if (!ok) return false;
    const refs = plan.copies.map((c) => ({ kind: c.kind, index: c.index }));
    this.selectMany(refs);
    const one = plan.copies.length === 1 ? plan.copies[0]! : null;
    const text = one ? jaEventMulti.duplicatedOne(`${ja.event.kindNames[one.kind] ?? one.kind}${one.index}`, one.x, one.y) : jaEventMulti.duplicated(plan.copies.length);
    this.state.setStatus(plan.skipped > 0 ? text + jaEventMulti.skipped(plan.skipped) : text);
    return true;
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
    if (!id) return;
    // 複数選択なら、まとめて消す（#399。フライトポジションは消さない。確認は 1 回）
    if (this.multi.multiple && this.host.deleteEvents) {
      const list = this.multi.list().filter((r) => r.kind !== "fly");
      if (list.length === 0) return this.state.setStatus(jaEventDelete.cannotFly, undefined, true);
      this.editor.endSession();
      return this.host.deleteEvents(list);
    }
    if (this.kind === "fly" || this.count() === 0) return;
    this.editor.endSession();
    this.host.deleteEvent(this.kind, this.index);
  }

  /** 右クリック: イベントの上なら選んで、「イベントを削除」と「スクリプトを開く」のメニューを出す。 */
  contextMenu(cell: RawCell, x: number, y: number): void {
    // ルーラーを伸ばして離したときはメニューを出さない（#400。同じマスで離したら今までどおり出す）
    if (this.skipMenu) {
      this.skipMenu = false;
      return;
    }
    // Ctrl を押している間はイベントを無いものとして、下のブロックを拾う（#238）
    if (ctrlPeek.held) return this.pickBlock(cell);
    const hit = eventAt(this.placed, cell.x, cell.y);
    // 「ここにひな形を置く」（#243）。プロジェクトフォルダを開いているときだけ、イベントの無いマスでも出す
    const templates = [
      ...(this.host.canPlaceTemplate?.() ? [{ id: "placeTemplate", label: jaTemplate.menuPlace, run: () => this.host.placeTemplate?.(cell.x, cell.y) }] : []),
      // 「ここに人を追加」など（#304）
      ...this.quickAdd.items(cell.x, cell.y),
      ...(this.host.placePlayer && this.state.session ? [{ id: "placePlayer", label: jaPlayback.placePlayer, run: () => this.host.placePlayer?.(cell.x, cell.y) }] : []),
    ];
    if (!hit) {
      if (templates.length > 0) showContextMenu(x, y, templates);
      return;
    }
    // 複数選択の中のイベントなら、選んだままにする（#399。「削除」と「複製」は選んでいる全部に）
    const many = this.multi.multiple && this.multi.has({ kind: hit.kind, index: hit.index });
    if (many) this.focus(hit.kind, hit.kind === "fly" ? 0 : hit.index);
    else this.select(hit.kind, hit.kind === "fly" ? 0 : hit.index);
    const kind = hit.kind;
    const index = hit.index;
    const scriptKind = kind === "person" || kind === "sign" || kind === "trap" ? kind : null;
    const signItem = kind === "sign" && this.state.map?.doc.events?.signs[index]?.content.type !== "script";
    const deletable = many ? this.multi.list().filter((r) => r.kind !== "fly").length : kind !== "fly" ? 1 : 0;
    showContextMenu(x, y, [
      {
        id: "delete",
        label: many ? jaEventMulti.menuDeleteMany(deletable) : jaEventDelete.menuDelete,
        enabled: deletable > 0,
        run: () => this.removeSelected(),
      },
      {
        id: "openScript",
        label: jaEventDelete.menuOpenScript,
        enabled: scriptKind !== null && !signItem,
        run: () => scriptKind && this.openScript(scriptKind, index),
      },
      // 素の ROM でも、スクリプトが ROM のアドレスのままのイベントは再生できる（#459）
      { id: "playScript", label: jaPlayback.menu, enabled: scriptKind !== null && !signItem && (this.state.session?.projectDir != null || this.romScriptOf(scriptKind, index)), run: () => scriptKind && this.host.playScript?.(scriptKind, index) },
      { id: "duplicate", label: jaEventMulti.menuDuplicate, enabled: kind !== "fly" || many, run: () => void this.duplicateSelected() },
      // 「行き先のマップを作る」（#241。ワープだけ）
      ...(kind === "warp" && this.host.createWarpMap ? [{ id: "createWarpMap", label: jaWarpMap.menu, run: () => this.host.createWarpMap?.(index) }] : []),
      // 「トレーナーを編集」（#274。人だけ。trainers.json を書くのでプロジェクトフォルダがあるときだけ。クローンは参照先を直す）
      ...(kind === "person" && this.host.editTrainer && this.state.session?.projectDir && this.state.map?.doc.events?.persons[index]?.kind !== 1
        ? [{ id: "editTrainer", label: jaTrainer.menuEdit, run: () => this.host.editTrainer?.(index) }]
        : []),
      ...templates,
    ]);
  }

  /** イベントのスクリプトが ROM のアドレス（0x08〜0x09）か。 */
  private romScriptOf(kind: "person" | "sign" | "trap", index: number): boolean {
    const events = this.state.map?.doc.events;
    const pointer = !events ? undefined : kind === "person" ? events.persons[index]?.script : kind === "trap" ? events.traps[index]?.script : signScript(events.signs[index]);
    return pointer !== undefined && pointer >>> 24 >= 0x08 && pointer >>> 24 <= 0x09;
  }

  /** イベントマネージャーの「設定」。 */
  private setCounts(counts: EventCounts): void {
    const id = this.state.map?.id;
    if (!id) return;
    // 人の数が変われば、隣のマップのクローンも合わせる（#242）
    if (this.editor.runWithClones(new SetEventCountsCommand({ ...id, ...counts }), id)) this.manager.show(this.counts(), true);
  }
}
