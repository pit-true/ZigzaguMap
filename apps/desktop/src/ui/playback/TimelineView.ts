import { CAMERA_ID, PLAYER_ID, movementAction, type OverworldSprites, type PlaybackMarker, type PlaybackSegment, type PlaybackSource, type Timeline } from "@zigzagumap/core";
import { jaPlayback as t } from "../../i18n/ja.playback";
import { canvasOf } from "../canvas";
import { sameBlock } from "./TimelineEditor";

/** 箱の編集（#458）。index は `Timeline.segments` の番号。 */
export interface TimelineEditing {
  /** 箱ごとの編集できない理由（編集できるなら null）。 */
  readonly locks: readonly (string | null)[];
  menu(index: number, x: number, y: number): void;
  /** 扱ったら true。 */
  key(index: number, event: KeyboardEvent): boolean;
  move(from: number, to: number): void;
}

/** フレームを横軸に置く。人物の行と全体の印は、計算結果の区間をそのまま使う。 */
export class TimelineView {
  readonly element = document.createElement("div");
  private readonly content = document.createElement("div");
  private readonly cursor = document.createElement("div");
  private scale = 2;
  private readonly labels = 100;
  private timeline: Timeline | null = null;
  private readonly boxes: { segment: PlaybackSegment; button: HTMLButtonElement; index: number }[] = [];
  private selected: number | null = null;
  /** 待つ命令（waitdooranim）の帯（#474）。 */
  private readonly waits: { start: number; until: number; element: HTMLElement }[] = [];

  /** 人物の行の見出し（イベントの欄の「人No.」に合わせる。PlaybackController が入れる）。 */
  personName: (localId: number) => string = (localId) => `${t.person} ${localId}`;

  constructor(private readonly seek: (frame: number) => void, private readonly openSource: (source: PlaybackSource) => void) {
    this.element.className = "playback-timeline"; this.element.dataset["autoId"] = "playback.timeline";
    this.content.className = "playback-timeline-content";
    this.cursor.className = "playback-time-cursor"; this.cursor.dataset["autoId"] = "playback.cursor";
    this.element.append(this.content);
    this.element.addEventListener("wheel", event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const x = event.clientX - this.element.getBoundingClientRect().left;
      const frame = (this.element.scrollLeft + x - this.labels) / this.scale;
      this.scale = Math.max(0.25, Math.min(8, this.scale * (event.deltaY < 0 ? 1.25 : 0.8)));
      this.layout(); this.element.scrollLeft = frame * this.scale + this.labels - x;
    }, { passive: false });
  }

  /** answer は選択肢・選び直せる分岐の今の答え（印に添える）。印を押すとそのフレームへ飛び、帯の下で選び直せる。 */
  setTimeline(timeline: Timeline, sprites: OverworldSprites, answer: (marker: PlaybackMarker) => string | null = () => null, editing: TimelineEditing | null = null): void {
    const keep = this.selected;
    this.timeline = timeline; this.boxes.length = 0; this.waits.length = 0; this.content.replaceChildren(); this.selected = null;
    const row = (title: string, id: string): HTMLElement => {
      const row = document.createElement("div"), label = document.createElement("div");
      row.className = "playback-time-row"; row.dataset["autoId"] = id;
      label.className = "playback-time-label"; label.textContent = title; row.append(label); this.content.append(row); return row;
    };
    const axis = row(t.timeAxis, "playback.axis");
    axis.addEventListener("pointerdown", event => {
      if ((event.target as HTMLElement).closest(".playback-time-label")) return;
      event.preventDefault();
      try { axis.setPointerCapture(event.pointerId); } catch { /* 自動操作のPointerEventには捕捉する実ポインタが無い場合がある。 */ }
      const move = (e: PointerEvent): void => { const x = e.clientX - this.content.getBoundingClientRect().left - this.labels; this.seek(Math.round(x / this.scale)); };
      move(event);
      axis.addEventListener("pointermove", move);
      const finish = (): void => {
        axis.removeEventListener("pointermove", move); axis.removeEventListener("pointerup", finish); axis.removeEventListener("pointercancel", finish);
      };
      axis.addEventListener("pointerup", finish); axis.addEventListener("pointercancel", finish);
    });
    const global = row(t.globalTrack, "playback.track.global");
    timeline.markers.forEach((marker, index) => {
      const button = document.createElement("button"); button.className = "playback-time-mark";
      const answered = answer(marker);
      button.textContent = answered === null ? t.markerNames[marker.kind] : `${t.markerNames[marker.kind]}: ${answered}`;
      if (answered !== null) button.classList.add("answer");
      button.title = `${t.frames(marker.frame)}: ${marker.detail}`;
      button.dataset["autoId"] = `playback.marker.${index}`; button.dataset["frame"] = String(marker.frame);
      button.addEventListener("click", () => this.seek(marker.frame));
      if (marker.until !== undefined && marker.until > marker.frame) {
        const wait = document.createElement("div"); wait.className = "playback-time-wait";
        wait.title = `${button.textContent}: ${t.frames(marker.frame)} → ${t.frames(marker.until)}`;
        wait.dataset["autoId"] = `playback.wait.${this.waits.length}`;
        global.append(wait); this.waits.push({ start: marker.frame, until: marker.until, element: wait });
      }
      global.append(button);
    });
    for (const track of timeline.tracks) {
      const title = track.id === PLAYER_ID ? t.player : track.id === CAMERA_ID ? t.camera : this.personName(track.id);
      const trackRow = row(title, `playback.track.${track.id}`);
      const image = sprites.image(track.initial.graphicsId);
      if (image) { const portrait = canvasOf(image); portrait.className = "playback-time-portrait"; trackRow.firstElementChild!.prepend(portrait); }
      for (const segment of timeline.segmentsOf(track.id)) {
        const button = document.createElement("button"), action = movementAction(segment.movementId);
        button.className = "playback-time-segment";
        button.textContent = `${segment.step?.text ?? action?.sourceName ?? segment.movementId}${action?.direction ? ` ${t.arrows[action.direction]}` : ""}`;
        button.title = `${button.textContent}: ${action ? t.movementMotion(action) : t.unknown}\n${t.frames(segment.start)} → ${t.frames(segment.end)}`;
        button.dataset["autoId"] = `playback.segment.${this.boxes.length}`;
        const index = timeline.segments.indexOf(segment);
        button.dataset["segment"] = String(index);
        const lock = editing?.locks[index] ?? null;
        if (editing && lock) { button.classList.add("locked"); button.title += `\n${lock}`; }
        let dragged = false;
        button.addEventListener("click", () => { if (dragged) { dragged = false; return; } this.select(index); this.seek(segment.start); });
        button.addEventListener("dblclick", () => this.openSource(segment.command));
        if (editing) {
          button.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); this.select(index); editing.menu(index, event.clientX, event.clientY); });
          button.addEventListener("keydown", event => { if (editing.key(index, event)) { event.preventDefault(); event.stopPropagation(); } });
          if (!lock) this.dragToMove(button, index, editing, () => { dragged = true; });
        }
        trackRow.append(button); this.boxes.push({ segment, button, index });
      }
    }
    this.content.append(this.cursor); this.layout();
    if (keep !== null && keep < timeline.segments.length) this.select(keep);
  }

  /** 箱を選ぶ（Delete・Alt＋矢印の相手。null で外す）。 */
  select(index: number | null): void {
    this.selected = index;
    for (const box of this.boxes) box.button.classList.toggle("selected", box.index === index);
  }
  get selection(): number | null { return this.selected; }

  /** 横にドラッグして、同じ移動データの別の箱の上で離すと並べ替える。 */
  private dragToMove(button: HTMLButtonElement, index: number, editing: TimelineEditing, moved: () => void): void {
    button.addEventListener("pointerdown", down => {
      if (down.button !== 0) return;
      const startX = down.clientX;
      let dragging = false;
      const own = this.boxes.find(box => box.index === index)!;
      // 箱は動かさず、離す先の箱に印を付ける（動く部品の上の座標で、離す位置がずれないように）。
      const targetAt = (clientX: number) => {
        const x = clientX - this.content.getBoundingClientRect().left;
        return this.boxes.find(box => box.index !== index && sameBlock(own.segment, box.segment)
          && x >= Number.parseFloat(box.button.style.left) && x < Number.parseFloat(box.button.style.left) + Number.parseFloat(box.button.style.width)) ?? null;
      };
      const mark = (target: { button: HTMLButtonElement } | null): void => { for (const box of this.boxes) box.button.classList.toggle("drop-target", box === target); };
      const move = (e: PointerEvent): void => {
        if (!dragging && Math.abs(e.clientX - startX) < 5) return;
        if (!dragging) { dragging = true; try { button.setPointerCapture(e.pointerId); } catch { /* 自動操作のPointerEventには実ポインタが無い場合がある。 */ } button.classList.add("dragging"); }
        mark(targetAt(e.clientX));
      };
      const up = (e: PointerEvent): void => {
        button.removeEventListener("pointermove", move); button.removeEventListener("pointerup", up); button.removeEventListener("pointercancel", up);
        if (!dragging) return;
        moved(); mark(null); button.classList.remove("dragging");
        const target = e.type === "pointerup" ? targetAt(e.clientX) : null;
        if (target) editing.move(index, target.index);
      };
      button.addEventListener("pointermove", move); button.addEventListener("pointerup", up); button.addEventListener("pointercancel", up);
    });
  }

  update(frame: number): void {
    this.cursor.dataset["frame"] = String(frame);
    this.cursor.style.left = `${this.labels + frame * this.scale}px`;
    for (const { segment, button } of this.boxes) button.classList.toggle("active", frame >= segment.start && frame <= segment.end);
  }
  /** 自動操作の確かめ用: 倍率、横のスクロール、箱と印と縦線の位置（画素。行の左端から）。 */
  layoutInfo() {
    const left = (element: HTMLElement): number => Number.parseFloat(element.style.left) || 0;
    return {
      scale: this.scale, labels: this.labels, scrollLeft: this.element.scrollLeft, width: this.content.offsetWidth,
      cursor: left(this.cursor),
      segments: this.boxes.map(({ segment, button, index }) => ({ index, locked: button.classList.contains("locked"), selected: button.classList.contains("selected"), actor: segment.actor, start: segment.start, end: segment.end, left: left(button), width: Number.parseFloat(button.style.width) || 0, top: button.offsetTop + (button.parentElement?.offsetTop ?? 0), active: button.classList.contains("active") })),
      waits: this.waits.map(({ start, until, element }) => ({ start, until, left: left(element), width: Number.parseFloat(element.style.width) || 0 })),
      markers: [...this.content.querySelectorAll<HTMLElement>(".playback-time-mark")].map(marker => ({ frame: Number(marker.dataset["frame"]), left: left(marker), top: Number.parseFloat(marker.style.top) || 0, width: marker.offsetWidth, text: marker.textContent })),
    };
  }
  /** Ctrl＋ホイールと同じ拡大縮小（x は部品の左端からの画素）。 */
  wheel(deltaY: number, x: number): void {
    const rect = this.element.getBoundingClientRect();
    this.element.dispatchEvent(new WheelEvent("wheel", { deltaY, ctrlKey: true, clientX: rect.left + x, clientY: rect.top + 4, bubbles: true, cancelable: true }));
  }
  clear(): void { this.selected = null; this.timeline = null; this.boxes.length = 0; this.waits.length = 0; this.content.replaceChildren(); }

  private layout(): void {
    if (!this.timeline) return;
    this.content.style.width = `${this.labels + (this.timeline.lastFrame + 1) * this.scale + 12}px`;
    for (const { segment, button } of this.boxes) { button.style.left = `${this.labels + segment.start * this.scale}px`; button.style.width = `${Math.max(2, (segment.end - segment.start + 1) * this.scale)}px`; }
    for (const wait of this.waits) { wait.element.style.left = `${this.labels + wait.start * this.scale}px`; wait.element.style.width = `${Math.max(2, (wait.until - wait.start) * this.scale)}px`; }
    // 同じ頃の印は重ねず、段を分けて並べる（全体の行が段の数だけ高くなる）。
    const lanes: number[] = [];
    let row: HTMLElement | null = null;
    const markers = [...this.content.querySelectorAll<HTMLElement>(".playback-time-mark")];
    const widths = markers.map(marker => marker.offsetWidth); // 書く前にまとめて読む
    for (const [index, marker] of markers.entries()) {
      const left = this.labels + Number(marker.dataset["frame"]) * this.scale;
      marker.style.left = `${left}px`;
      // 段は 3 つまで。あふれた印は最後の段に重ねる（どれを押しても同じフレームへ飛び、答えの欄は帯の下にまとめて出る）。
      let lane = lanes.findIndex(right => right <= left);
      if (lane < 0 && lanes.length < 3) { lane = lanes.length; lanes.push(0); }
      if (lane < 0) lane = lanes.length - 1;
      lanes[lane] = Math.max(lanes[lane]!, left + widths[index]! + 1);
      marker.style.top = `${2 + lane * 22}px`;
      row = marker.parentElement;
    }
    if (row) row.style.height = `${Math.max(28, lanes.length * 22 + 6)}px`;
    const axis = this.content.firstElementChild!;
    for (const old of axis.querySelectorAll(".playback-time-tick")) old.remove();
    // 最大600秒でも、目盛りのDOMは約100個に収める。
    const spacing = Math.max(60, Math.ceil(64 / this.scale / 60) * 60, Math.ceil(this.timeline.lastFrame / 100 / 60) * 60);
    for (let f = 0; f <= this.timeline.lastFrame; f += spacing) {
      const tick = document.createElement("span"); tick.className = "playback-time-tick"; tick.style.left = `${this.labels + f * this.scale}px`;
      tick.textContent = `${f} / ${f / 60}s`; axis.append(tick);
    }
    this.update(Number(this.cursor.dataset["frame"] ?? 0));
  }
}
