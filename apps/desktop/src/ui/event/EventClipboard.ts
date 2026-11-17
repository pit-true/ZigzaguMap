import {
  CommandGroup,
  PERSON_KIND_CLONE,
  PasteEventCommand,
  SetItemBallCommand,
  pasteItems,
  placePaste,
  type Command,
  type EventLabel,
  type JsonObject,
  type MapId,
  type PasteItem,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { jaEventMulti as t } from "../../i18n/ja.eventMulti";
import type { MapView } from "../map/MapView";
import type { EventEditor } from "./EventEditor";
import { personsOverLimit } from "./EventLimits";
import type { EventRef } from "./EventSelection";
import { eventList, type ListKind } from "./eventModel";

/** コピーしたイベント 1 つ。 */
interface ClipItem {
  readonly kind: ListKind;
  /** 欄の値（座標を含む。コピーした時点の写し）。 */
  readonly event: JsonObject;
  readonly x: number;
  readonly y: number;
  /** スクリプトのラベル（Q10。貼った先でも同じラベルを指す）。 */
  readonly label: EventLabel | null;
  /** 落とし物の道具の番号（落とし物の人だけ）。 */
  readonly itemBall: number | null;
}

/** タブの外の機能。 */
export interface EventClipboardHost {
  readonly state: EditorState;
  readonly view: MapView;
  readonly editor: EventEditor;
  selected(): EventRef[];
  selectMany(refs: readonly EventRef[]): void;
  /** 選んでいるものを消す（今の削除の確認と同じ）。 */
  remove(): void;
  /** `.global` でないラベル（別の .s から見えない）。分からなければ空。 */
  notGlobal?(labels: readonly string[]): Promise<string[]>;
  /** コピーしたものが変わった（空になった）とき。イベントの無いマップでもマップの絵を出すかを決め直す（#536）。 */
  changed?(): void;
}

const LABEL_TARGET = { person: "person", sign: "sign", trap: "tile" } as const;
const GHOST_COLOR: Readonly<Record<ListKind, string>> = { person: "#2060ff", sign: "#e08000", warp: "#d02020", trap: "#20a040" };

/**
 * イベントのコピー・切り取り・貼り付け（Phase7 #519）。アプリの中だけのクリップボードで、マップを切り替えても残り、ROM を開き直すと消える。
 * 貼るときは、写したイベントの影（互いの位置を保つ）をマウスに付け、左クリックで置き、Esc・右クリックで取りやめる。
 * どれかがマップの外になる・同じ種類のイベントと同じマスに重なるときは全部を置かない。1 回の貼り付けは 1 回の「元に戻す」。
 */
export class EventClipboard {
  private items: ClipItem[] = [];
  private source: MapId | null = null;
  private placing: { items: PasteItem[]; cell: { x: number; y: number } | null; off: () => void } | null = null;
  private readonly ghost = document.createElement("canvas");

  constructor(private readonly host: EventClipboardHost) {
    this.ghost.className = "event-paste-ghost";
    this.ghost.dataset["autoId"] = "event.pasteGhost";
    host.state.on("session", () => { this.cancel(true); this.items = []; this.source = null; host.changed?.(); });
    host.state.on("map", () => this.cancel(true));
    host.state.on("tab", () => this.cancel(true));
  }

  get count(): number { return this.items.length; }
  get pasting(): boolean { return this.placing !== null; }
  /** 自動操作に返す中身。 */
  describe(): { source: MapId | null; items: { kind: ListKind; x: number; y: number; label: string | null }[]; pasting: boolean } {
    return { source: this.source, items: this.items.map(i => ({ kind: i.kind, x: i.x, y: i.y, label: i.label?.label ?? null })), pasting: this.pasting };
  }

  /** 選んでいるイベントをコピーする。コピーした数（フライトポジションとクローンは写さない）。 */
  copy(): number {
    const map = this.host.state.map, events = map?.doc.events, session = this.host.state.session;
    if (!map || !events) return 0;
    const items: ClipItem[] = [];
    let skipped = 0;
    for (const ref of this.host.selected()) {
      if (ref.kind === "fly") { skipped++; continue; }
      const kind = ref.kind;
      const event = eventList(events, kind)[ref.index] as (object & { x: number; y: number }) | undefined;
      if (!event || (kind === "person" && events.persons[ref.index]!.kind === PERSON_KIND_CLONE)) { skipped++; continue; }
      const target = kind === "warp" ? null : LABEL_TARGET[kind];
      const label = target ? session?.labels.store.label(map.id.bank, map.id.map, target, ref.index) ?? null : null;
      const ball = kind === "person" ? map.doc.itemBalls.find(b => b.personIndex === ref.index) : undefined;
      items.push({ kind, event: JSON.parse(JSON.stringify(event)) as JsonObject, x: event.x, y: event.y, label: label ? { ...label } : null, itemBall: ball ? ball.itemId : null });
    }
    if (items.length === 0) {
      this.host.state.setStatus(t.nothingToCopy, undefined, true);
      return 0;
    }
    const was = this.items.length;
    this.items = items; this.source = map.id;
    if (was === 0) this.host.changed?.();
    const text = t.copied(items.length, `${map.id.bank}.${map.id.map}`);
    this.host.state.setStatus(skipped > 0 ? text + t.copySkipped(skipped) : text);
    return items.length;
  }

  /** コピーしてから消す（今の削除の確認を出す）。 */
  cut(): number {
    const n = this.copy();
    if (n > 0) this.host.remove();
    return n;
  }

  /** 影をマウスに付けて、置く位置を待つ（Ctrl+V）。 */
  startPaste(): void {
    if (this.items.length === 0) return this.host.state.setStatus(t.clipboardEmpty, undefined, true);
    this.cancel(true);
    const items = pasteItems(this.items).items;
    const view = this.host.view, element = view.element;
    const move = (e: PointerEvent): void => {
      if (!this.placing) return;
      const cell = view.rawCellAt(e);
      if (this.placing.cell && cell.x === this.placing.cell.x && cell.y === this.placing.cell.y) return;
      this.placing.cell = cell; this.drawGhost();
    };
    const down = (e: PointerEvent): void => {
      if (!this.placing || !view.cellAtAny(e)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.button === 0) { const cell = view.rawCellAt(e); this.cancel(true); this.pasteAt(cell.x, cell.y); }
      else this.cancel();
    };
    const swallow = (e: Event): void => { if (this.placing) { e.preventDefault(); e.stopPropagation(); } };
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape" && this.placing) { e.preventDefault(); e.stopImmediatePropagation(); this.cancel(); } };
    element.addEventListener("pointermove", move, true);
    element.addEventListener("pointerdown", down, true);
    element.addEventListener("contextmenu", swallow, true);
    window.addEventListener("keydown", key, true);
    this.placing = {
      items, cell: null,
      off: () => {
        element.removeEventListener("pointermove", move, true);
        element.removeEventListener("pointerdown", down, true);
        element.removeEventListener("contextmenu", swallow, true);
        window.removeEventListener("keydown", key, true);
      },
    };
    view.stage.append(this.ghost);
    this.host.state.setStatus(t.pasting(items.length));
  }

  /** 影を外す。quiet でなければ取りやめたと知らせる。 */
  cancel(quiet = false): void {
    if (!this.placing) return;
    this.placing.off(); this.placing = null;
    this.ghost.remove(); this.ghost.width = 0; this.ghost.height = 0;
    if (!quiet) this.host.state.setStatus(t.pasteCancelled);
  }

  /** (x, y) を左上にして貼る。置けたら true。 */
  pasteAt(x: number, y: number): boolean {
    this.cancel(true);
    const map = this.host.state.map;
    if (!map) return false;
    if (this.items.length === 0) { this.host.state.setStatus(t.clipboardEmpty, undefined, true); return false; }
    const doc = map.doc, events = doc.events ?? { persons: [], warps: [], traps: [], signs: [] };
    const items = pasteItems(this.items).items;
    const occupied = { person: events.persons, warp: events.warps, trap: events.traps, sign: events.signs };
    const placed = placePaste(items, x, y, { width: doc.width, height: doc.height, occupied });
    if (!placed.ok) {
      const item = this.items[placed.item]!;
      const what = `${ja.event.kindNames[item.kind] ?? item.kind}`;
      this.host.state.setStatus(placed.reason === "outside" ? t.pasteOutside(placed.x, placed.y) : t.pasteOverlap(what, placed.x, placed.y), undefined, true);
      return false;
    }
    const next: Record<ListKind, number> = { person: events.persons.length, sign: events.signs.length, warp: events.warps.length, trap: events.traps.length };
    const commands: Command[] = [];
    const refs: EventRef[] = [];
    for (const [i, item] of this.items.entries()) {
      const at = placed.positions[i]!;
      const index = next[item.kind]++;
      commands.push(new PasteEventCommand({ ...map.id, kind: item.kind, event: item.event, x: at.x, y: at.y, ...(item.label ? { label: { label: item.label.label, kind: item.label.kind } } : {}) }));
      if (item.itemBall !== null) commands.push(new SetItemBallCommand({ ...map.id, personIndex: index, itemId: item.itemBall }));
      refs.push({ kind: item.kind, index });
    }
    const command = CommandGroup.of(commands);
    const editor = this.host.editor;
    editor.endSession();
    // 人を貼ったら、隣のマップのクローンも合わせる（#242。複製と同じ）
    const ok = refs.some(r => r.kind === "person") ? editor.runWithClones(command, map.id) : editor.run(command);
    editor.endSession();
    if (!ok) return false;
    this.host.selectMany(refs);
    let text = t.pasted(refs.length);
    const persons = map.doc.events?.persons.length ?? 0;
    if (personsOverLimit(persons)) text += t.pasteLimit(persons);
    this.host.state.setStatus(text);
    // 別のマップへ貼ったときは、.global でないラベルを知らせる（貼るのは止めない。Q10）
    const other = this.source && (this.source.bank !== map.id.bank || this.source.map !== map.id.map);
    const labels = [...new Set(this.items.flatMap(i => i.label ? [i.label.label] : []))];
    if (other && labels.length > 0 && this.host.notGlobal) {
      void this.host.notGlobal(labels).then(names => { if (names.length > 0) this.host.state.setStatus(text + t.notGlobal(names), undefined, true); }).catch(() => undefined);
    }
    return true;
  }

  private drawGhost(): void {
    const p = this.placing, map = this.host.state.map, view = this.host.view;
    if (!p || !p.cell || !map) return;
    const size = view.cellSize, origin = view.originPx;
    const w = Math.max(...p.items.map(i => i.dx)) + 1, h = Math.max(...p.items.map(i => i.dy)) + 1;
    Object.assign(this.ghost.style, { left: `${origin.x + p.cell.x * size}px`, top: `${origin.y + p.cell.y * size}px`, width: `${w * size}px`, height: `${h * size}px` });
    if (this.ghost.width !== w * size || this.ghost.height !== h * size) { this.ghost.width = w * size; this.ghost.height = h * size; }
    const c = this.ghost.getContext("2d")!;
    c.clearRect(0, 0, this.ghost.width, this.ghost.height);
    const ok = placePaste(p.items, p.cell.x, p.cell.y, { width: map.doc.width, height: map.doc.height, occupied: { person: map.doc.events?.persons ?? [], warp: map.doc.events?.warps ?? [], trap: map.doc.events?.traps ?? [], sign: map.doc.events?.signs ?? [] } }).ok;
    const line = Math.max(1, size / 16);
    for (const item of p.items) {
      c.globalAlpha = 0.45; c.fillStyle = ok ? GHOST_COLOR[item.kind] : "#d00000";
      c.fillRect(item.dx * size, item.dy * size, size, size);
      c.globalAlpha = 1; c.strokeStyle = ok ? "#ffffff" : "#ff0000"; c.lineWidth = line;
      c.strokeRect(item.dx * size + line / 2, item.dy * size + line / 2, size - line, size - line);
    }
  }
}
