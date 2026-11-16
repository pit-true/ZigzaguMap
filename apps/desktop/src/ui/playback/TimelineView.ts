import { CAMERA_ID, PLAYER_ID, movementAction, type OverworldSprites, type PlaybackSegment, type PlaybackSource, type Timeline } from "@zigzagumap/core";
import { jaPlayback as t } from "../../i18n/ja.playback";
import { canvasOf } from "../canvas";

/** フレームを横軸に置く。人物の行と全体の印は、計算結果の区間をそのまま使う。 */
export class TimelineView {
  readonly element = document.createElement("div");
  private readonly content = document.createElement("div");
  private readonly cursor = document.createElement("div");
  private scale = 2;
  private readonly labels = 100;
  private timeline: Timeline | null = null;
  private readonly boxes: { segment: PlaybackSegment; button: HTMLButtonElement }[] = [];

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

  setTimeline(timeline: Timeline, sprites: OverworldSprites): void {
    this.timeline = timeline; this.boxes.length = 0; this.content.replaceChildren();
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
      button.textContent = t.markerNames[marker.kind]; button.title = `${t.frames(marker.frame)}: ${marker.detail}`;
      button.dataset["autoId"] = `playback.marker.${index}`; button.dataset["frame"] = String(marker.frame);
      button.addEventListener("click", () => this.seek(marker.frame));
      global.append(button);
    });
    for (const track of timeline.tracks) {
      const title = track.id === PLAYER_ID ? t.player : track.id === CAMERA_ID ? t.camera : `${t.person} ${track.id}`;
      const trackRow = row(title, `playback.track.${track.id}`);
      const image = sprites.image(track.initial.graphicsId);
      if (image) { const portrait = canvasOf(image); portrait.className = "playback-time-portrait"; trackRow.firstElementChild!.prepend(portrait); }
      for (const segment of timeline.segmentsOf(track.id)) {
        const button = document.createElement("button"), action = movementAction(segment.movementId);
        button.className = "playback-time-segment";
        button.textContent = `${segment.step?.text ?? action?.sourceName ?? segment.movementId}${action?.direction ? ` ${t.arrows[action.direction]}` : ""}`;
        button.title = `${button.textContent}: ${action ? t.movementMotion(action) : t.unknown}\n${t.frames(segment.start)} → ${t.frames(segment.end)}`;
        button.dataset["autoId"] = `playback.segment.${this.boxes.length}`;
        button.addEventListener("click", () => this.seek(segment.start));
        button.addEventListener("dblclick", () => this.openSource(segment.command));
        trackRow.append(button); this.boxes.push({ segment, button });
      }
    }
    this.content.append(this.cursor); this.layout();
  }

  update(frame: number): void {
    this.cursor.dataset["frame"] = String(frame);
    this.cursor.style.left = `${this.labels + frame * this.scale}px`;
    for (const { segment, button } of this.boxes) button.classList.toggle("active", frame >= segment.start && frame <= segment.end);
  }
  clear(): void { this.timeline = null; this.boxes.length = 0; this.content.replaceChildren(); }

  private layout(): void {
    if (!this.timeline) return;
    this.content.style.width = `${this.labels + (this.timeline.lastFrame + 1) * this.scale + 12}px`;
    for (const { segment, button } of this.boxes) { button.style.left = `${this.labels + segment.start * this.scale}px`; button.style.width = `${Math.max(2, (segment.end - segment.start + 1) * this.scale)}px`; }
    for (const marker of this.content.querySelectorAll<HTMLElement>(".playback-time-mark")) marker.style.left = `${this.labels + Number(marker.dataset["frame"]) * this.scale}px`;
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
