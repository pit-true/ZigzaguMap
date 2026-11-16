import { buildPlaybackStart, CHOICE_CANCEL, PlaybackAnimation, simulatePlayback, type MovementDirection, type PlaybackChoiceMark, type PlaybackMarker, type PlaybackTrigger, type PlayerGender, type ProvisionalPlayer, type Timeline } from "@zigzagumap/core";
import type { App } from "../../app/App";
import type { OpenMap } from "../../app/ProjectSession";
import { prepareActorScene } from "../../app/ActorScene";
import type { MapView } from "../map/MapView";
import type { ScriptTarget } from "../script/ScriptEntry";
import { ScriptLocator } from "../script/ScriptLocator";
import { jaPlayback as t } from "../../i18n/ja.playback";
import { errorText } from "../../util/errors";
import { PlaybackProjectData } from "./PlaybackProject";
import { PlaybackClock } from "./PlaybackClock";
import { PlaybackBar } from "./PlaybackBar";
import { TimelineView } from "./TimelineView";
import { TimelineEditor } from "./TimelineEditor";
import { isScriptSourcePath } from "@zigzagumap/core";
import type { PlaybackHighlightSpan } from "../../windows/script-editor/protocol";
import { MessageRenderer, messageSkin } from "./MessageView";
import { PlaybackTime } from "./PlaybackTime";
import { matchesKey } from "../../app/keymap";
import "../../styles/playback.css";
import { scheduleIdleGc } from "../../util/idleGc";

export interface PlaybackRequest {
  readonly label?: string;
  readonly target?: ScriptTarget;
  /** 仮の主人公が話しかけた・踏んだときの位置と向き（#457）。主人公はここから始める。 */
  readonly origin?: ProvisionalPlayer;
  /** 準備ができたらすぐ再生する（踏むスクリプト）。 */
  readonly play?: boolean;
}

/** メインのマップ上の再生。終了時には仮配置とスクロールを戻し、マップのデータを書き換えない。 */
export class PlaybackController {
  private data: PlaybackProjectData | null = null;
  private request: PlaybackRequest | null = null;
  private sourceMap: OpenMap | null = null;
  private entry = "";
  private trigger: PlaybackTrigger = { kind: "map" };
  private timeline: Timeline | null = null;
  private animation: PlaybackAnimation | null = null;
  private clock: PlaybackClock | null = null;
  private raf: number | null = null;
  private generation = 0;
  private hadPreview = false;
  /** 人物を動かす（#471）の止めの解除。 */
  private npcRelease: (() => void) | null = null;
  private gender: PlayerGender = "male";
  private facing: MovementDirection | null = null;
  private absent: readonly number[] = [];
  private readonly answers = new Map<string, boolean>();
  private readonly choices = new Map<string, number>();
  /** 素の ROM のスクリプトを再生しているときの位置（#459）。 */
  private romPointer: number | null = null;
  private readonly consumed = new Set<number>();
  private highlightKey = "";
  /** メッセージの窓（ROM のフォント。#497）。再生の間だけ持つ。 */
  private messages: MessageRenderer | null = null;
  private time: PlaybackTime | null = null;
  private cleanup: Promise<void> = Promise.resolve();
  private scrolls: { view: MapView; left: number; top: number; hidden: HTMLElement["hidden"] }[] = [];
  private readonly bar: PlaybackBar;
  private readonly timelineView: TimelineView;
  private readonly resize: ResizeObserver;
  readonly editor: TimelineEditor;
  private reloadTimer: number | null = null;
  private reloading: Promise<void> = Promise.resolve();

  constructor(private readonly app: App) {
    this.bar = new PlaybackBar({
      toggle: () => this.toggle(), stop: () => this.stop(), seek: frame => this.seek(frame),
      step: direction => this.step(direction), speed: value => this.setSpeed(value),
      startState: (gender, facing, absent) => {
        this.gender = gender; this.facing = facing; this.absent = absent;
        this.app.state.settings.update({ playbackGender: gender });
        this.calculate();
      },
    });
    this.timelineView = new TimelineView(frame => this.seek(frame), source => { void this.app.scriptHost().then(host => host.openFile(source.path, source.line + 1)).catch(error => this.app.state.setStatus(errorText(error), undefined, true)); });
    this.bar.element.append(this.timelineView.element);
    this.resize = new ResizeObserver(() => { if (this.active) this.mount(); });
    for (const view of this.views()) this.resize.observe(view.element);
    app.state.on("map", () => this.stop()); app.state.on("session", () => this.stop());
    this.editor = new TimelineEditor({ app, data: () => this.data, timeline: () => this.timeline, reload: () => this.reload() });
    // 取り消し・やり直しや外での書き換えで .s が変わったら、読み直して計算し直す（#458）。
    app.scripts.files.onPathChange(path => {
      if (!this.active || !isScriptSourcePath(path)) return;
      if (this.reloadTimer !== null) clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => { this.reloadTimer = null; void this.reload().catch(error => this.app.state.setStatus(errorText(error), undefined, true)); }, 30);
    });
    app.state.on("tab", () => { if (this.active) { this.pause(); this.mount(); this.draw(); } });
    this.bar.element.addEventListener("keydown", event => {
      const target = event.target as HTMLElement;
      if (target.matches("input,select,textarea") || (target.matches("button") && (event.key === " " || event.key === "Enter"))) return;
      if (matchesKey("playback.toggle", event)) this.toggle();
      else if (matchesKey("playback.first", event)) this.seek(0);
      else if (matchesKey("playback.last", event)) this.seek(this.timeline?.lastFrame ?? 0);
      else if (matchesKey("playback.previous", event)) this.step(-1);
      else if (matchesKey("playback.next", event)) this.step(1);
      else if (matchesKey("playback.previousFrame", event)) this.step(-1, true);
      else if (matchesKey("playback.nextFrame", event)) this.step(1, true);
      else return;
      event.preventDefault(); event.stopPropagation();
    });
  }

  get active(): boolean { return this.clock !== null; }
  state() {
    return this.clock && this.timeline && this.animation ? { active: true, entry: this.entry, trigger: this.trigger, playing: this.clock.playing, speed: this.clock.speed, lastFrame: this.timeline.lastFrame, ...this.animation.stateAt(this.clock.frame), issues: this.animation.issues } : { active: false };
  }
  get result(): Timeline | null { return this.timeline; }
  get timelineUi(): TimelineView { return this.timelineView; }

  /** 本文を読み直して計算し直す。今のフレーム・答え・始めの状態は保つ。 */
  reload(): Promise<void> {
    const run = async (): Promise<void> => {
      if (!this.active) return;
      const token = this.generation, map = this.app.state.map;
      const data = this.romPointer !== null ? await PlaybackProjectData.fromRom(this.app, this.romPointer) : await PlaybackProjectData.load(this.app);
      if (token !== this.generation || map !== this.app.state.map || !this.active) return;
      if (!data.project.index.findLabel(this.entry)) throw new Error(t.noEntry);
      this.data = data; this.calculate();
    };
    return (this.reloading = this.reloading.catch(() => undefined).then(run));
  }
  /** 書き戻しと読み直しが済むまで待つ（自動操作）。 */
  async settled(): Promise<void> {
    await this.editor.idle();
    while (this.reloadTimer !== null) await new Promise(resolve => setTimeout(resolve, 20));
    await this.reloading.catch(() => undefined);
  }

  async start(request: PlaybackRequest): Promise<void> {
    this.stop();
    const token = ++this.generation, session = this.app.state.session, map = this.app.state.map;
    if (!map || !session) throw new Error(t.noMap);
    // ラベルで始めるときはプロジェクトが要る。イベントは、ラベルが無くてスクリプトが ROM のアドレスのままなら ROM から再生する（#459）。
    const location = request.target && session.projectDir ? await new ScriptLocator(this.app, session.files).resolve(request.target) : null;
    const romPointer = request.target && !location?.label ? eventRomPointer(map, request.target) : null;
    // イベントにラベルも ROM のスクリプトも無い（アドレスが 0 など）ときは、その相手にスクリプトが無いと知らせる（#495）
    if (request.target && !location?.label && romPointer === null) throw new Error(t.noScript(request.target.kind));
    if (!session.projectDir && romPointer === null) throw new Error(t.projectRequired);
    await this.cleanup;
    if (token !== this.generation) return;
    const data = romPointer !== null ? await PlaybackProjectData.fromRom(this.app, romPointer) : await PlaybackProjectData.load(this.app);
    if (token !== this.generation || map !== this.app.state.map) return;
    const entry = data.romEntry ?? request.label ?? location?.label;
    if (!entry || !data.project.index.findLabel(entry)) throw new Error(t.noEntry);
    this.romPointer = romPointer;
    const skin = await messageSkin(session, request.target?.kind === "sign");
    await prepareActorScene(session);
    if (token !== this.generation || map !== this.app.state.map) return;
    const talked = request.target, speaker = talked?.kind === "person" && talked.index !== undefined ? map.doc.events?.persons[talked.index]?.graphicsId ?? null : null;
    this.messages = new MessageRenderer(session, skin, speaker);
    this.request = request; this.sourceMap = map; this.data = data; this.entry = entry;
    const target = request.target;
    this.trigger = target?.kind === "person" ? { kind: "person", localId: map.doc.events?.persons[target.index ?? 0]?.localId ?? -1 } : target?.kind === "sign" || target?.kind === "trap" ? { kind: target.kind, index: target.index ?? 0 } : { kind: "map" };
    this.gender = this.app.state.settings.data.playbackGender === "female" ? "female" : "male";
    this.facing = null; this.absent = []; this.answers.clear(); this.choices.clear();
    this.hadPreview = this.app.previewPlayer.enabled;
    // 再生中は人物の自分の動き（表示 > 人物を動かす、#471）を止める（A-5）
    this.npcRelease ??= this.app.npcMotion.hold("playback");
    this.time = new PlaybackTime(this.app.timeOfDay, () => session === this.app.state.session);
    this.scrolls = this.views().map(view => ({ view, left: view.element.scrollLeft, top: view.element.scrollTop, hidden: view.layer.hidden }));
    try {
      if (!this.hadPreview) this.app.previewPlayer.start();
      this.calculate();
      await this.app.previewPlayer.ready();
      if (token !== this.generation) return;
      this.mount(); this.draw(); await this.ready();
      if (token !== this.generation) return;
      this.bar.element.focus({ preventScroll: true });
      if (request.play) this.toggle();
    } catch (error) { this.stop(); throw error; }
  }

  stop(): void {
    this.generation++; this.pause();
    const hadState = this.request !== null;
    const sameMap = this.sourceMap === this.app.state.map;
    this.clock = null; this.timeline = null; this.animation = null; this.data = null; this.request = null; this.romPointer = null;
    this.bar.element.remove(); this.consumed.clear();
    this.timelineView.clear(); this.bar.clear(); this.answers.clear(); this.choices.clear();
    this.npcRelease?.(); this.npcRelease = null;
    // 再生の計算・タイムライン・画像を手放したので、落ち着いたら GC して空いた領域を OS へ返す（#496）
    if (hadState) scheduleIdleGc(true);
    if (hadState) {
      this.app.previewPlayer.setPlayback(null);
      if (this.hadPreview) this.app.previewPlayer.setPlayer({ gender: this.gender });
      if (!this.hadPreview) this.app.previewPlayer.stop(true);
      for (const saved of this.scrolls) {
        saved.view.layer.hidden = saved.hidden;
        if (sameMap) { saved.view.element.scrollLeft = saved.left; saved.view.element.scrollTop = saved.top; }
      }
      this.scrolls = [];
    }
    this.sourceMap = null;
    this.messages?.dispose(); this.messages = null;
    if (this.time) this.cleanup = this.time.stop().catch(() => undefined);
    this.time = null;
    this.highlightKey = "";
    void this.app.scriptHostIfLoaded().then(host => host?.playbackHighlight([])).catch(() => undefined);
  }

  seek(frame: number): void { this.pause(); this.clock?.seek(frame); this.consumed.clear(); this.draw(); }
  /** メッセージの窓（自動操作）。 */
  get messageWindow(): MessageRenderer | null { return this.messages; }
  async ready(): Promise<void> { await this.cleanup; await this.time?.ready(); await this.app.previewPlayer.ready(); }
  step(direction: -1 | 1, singleFrame = false): void { this.pause(); this.clock?.step(direction, singleFrame); this.consumed.clear(); this.draw(); }
  setSpeed(value: number): void { this.clock?.setSpeed(value); this.draw(); }
  answer(key: string, taken: boolean): void {
    if (!this.timeline?.markers.some(marker => marker.branch?.key === key && !marker.branch.known)) throw new Error(t.noBranch);
    this.answers.set(key, taken); this.calculate();
  }
  /** 選択肢の答えを替えて計算し直す（今のフレームは保つ）。 */
  choose(key: string, value: number): void {
    const choice = this.timeline?.markers.find(marker => marker.choice?.key === key)?.choice;
    if (!choice) throw new Error(t.noChoice);
    if (!Number.isInteger(value) || value < 0 || value > CHOICE_CANCEL || (choice.options && !choice.options.some(option => option.value === value))) throw new RangeError(t.choiceNumber);
    this.choices.set(key, value); this.calculate();
  }
  pause(): void { if (this.raf !== null) cancelAnimationFrame(this.raf); this.raf = null; this.clock?.pause(); }

  toggle(): void {
    const clock = this.clock;
    if (!clock) return;
    if (clock.playing) { this.pause(); this.draw(); return; }
    const at = this.nextMessage();
    if (at !== null && this.timeline!.markers[at]!.frame === clock.frame) {
      // 文の続きのページ（\p・\l・ボタン待ち）があれば、そこへ進めるだけ（#497）
      if (this.messages?.advance(at)) { this.draw(); return; }
      this.consumed.add(at);
      const next = this.nextMessage();
      if (next !== null && this.timeline!.markers[next]!.frame === clock.frame) { this.draw(); return; }
    }
    clock.play();
    const tick = (time: number): void => {
      this.raf = null;
      const next = this.nextMessage();
      clock.tick(time, next === null ? null : this.timeline!.markers[next]!.frame);
      this.draw();
      if (clock.playing) this.raf = requestAnimationFrame(tick);
    };
    this.draw();
    if (clock.playing) this.raf = requestAnimationFrame(tick);
  }

  private calculate(): void {
    this.pause();
    const map = this.app.state.map, data = this.data, sprites = this.app.state.session?.overworldSprites;
    if (!map || !data) return;
    if (!sprites) throw new Error(t.noSprites);
    const events = map.doc.events ?? { persons: [], warps: [], traps: [], signs: [] };
    const start = buildPlaybackStart({ events, trigger: this.trigger, gender: this.gender, facing: this.facing, absent: this.absent, provisionalPlayer: this.hadPreview ? this.app.previewPlayer.player : null, origin: this.request?.origin ?? null });
    this.bar.setCondition(start.trapCondition ? t.trapCondition(start.trapCondition.variable, start.trapCondition.value) : null);
    const keep = this.clock?.frame ?? 0;
    this.timeline = simulatePlayback({ project: data.project, entry: this.entry, start, answers: this.answers, choices: this.choices,
      elevationAt: (x, y) => x >= 0 && y >= 0 && x < map.doc.width && y < map.doc.height ? map.doc.grid.getMovement(x, y) >> 2 : null,
      // ドアの開け閉めと waitdooranim の待ち（#474）。
      doorWait: (doors, frame) => this.app.mapAnimations.doorWaitFor(doors, frame) });
    this.app.mapAnimations.setPlaybackDoors(this.timeline.markers.flatMap(m => m.door ? [m.door] : []));
    this.animation = new PlaybackAnimation(this.timeline, sprites);
    this.clock = new PlaybackClock(this.timeline.lastFrame, this.timeline.keyFrames());
    this.clock.seek(keep);
    this.consumed.clear();
    // 再生の画面の人物は、イベントの欄の「人No.」で呼ぶ（スクリプトの番号 localId も添える）
    const numbers = new Map(events.persons.map((person, index) => [person.localId, index + 1] as const));
    const personName = (localId: number): string => t.personName(numbers.get(localId) ?? null, localId);
    this.timelineView.personName = personName;
    this.bar.configure(this.timeline.lastFrame, this.gender, start.player.facing, events.persons.map(person => person.localId), this.absent, personName);
    const timeline = this.timeline;
    this.timelineView.setTimeline(timeline, sprites, marker => this.answerText(marker), {
      locks: this.editor.locks(timeline),
      menu: (index, x, y) => { this.pause(); this.editor.menu(index, x, y); },
      key: (index, event) => this.editor.key(index, event),
      move: (from, to) => { this.pause(); this.editor.move(from, to); },
    });
    for (const saved of this.scrolls) saved.view.layer.hidden = true;
    this.mount(); this.draw();
  }

  private nextMessage(): number | null {
    if (!this.clock || !this.timeline) return null;
    const found = this.timeline.markers.findIndex((m, i) => m.frame >= this.clock!.frame && !this.consumed.has(i) && (m.kind === "message" || m.kind === "choice"));
    return found < 0 ? null : found;
  }

  private views(): MapView[] { return [this.app.tabs.map.view, this.app.tabs.movement.view, this.app.tabs.event.view]; }
  private currentView(): MapView { return this.app.state.tab === "map" ? this.app.tabs.map.view : this.app.state.tab === "movement" ? this.app.tabs.movement.view : this.app.tabs.event.view; }
  private mount(): void {
    const view = this.currentView();
    if (!view.element.parentElement) return;
    view.element.parentElement.append(this.bar.element);
    this.bar.element.style.width = `${view.element.offsetWidth}px`;
  }
  private draw(): void {
    if (!this.clock || !this.animation || !this.timeline) return;
    this.time?.update(this.timeline.markers, this.clock.frame);
    this.app.previewPlayer.setPlayback(this.animation.stateAt(this.clock.frame));
    const message = this.nextMessage();
    this.bar.update(this.clock.frame, this.timeline.lastFrame, this.clock.playing, message !== null && this.timeline.markers[message]!.frame === this.clock.frame);
    this.timelineView.update(this.clock.frame);
    this.details();
    this.highlight();
    const view = this.currentView(), frame = this.app.previewPlayer.frame;
    if (frame) {
      const scale = view.screenCellSize / 16, origin = view.originPx, zoom = view.screenCellSize / view.cellSize;
      view.element.scrollLeft = origin.x * zoom + (frame.x + 120) * scale - view.element.clientWidth / 2;
      view.element.scrollTop = origin.y * zoom + (frame.y + 80) * scale - Math.max(160, view.element.clientHeight - this.bar.element.offsetHeight) / 2;
    }
  }
  private details(): void {
    const element = this.bar.details;
    element.replaceChildren();
    if (!this.timeline || !this.clock) return;
    for (const [index, marker] of this.timeline.markers.entries()) {
      if (marker.frame !== this.clock.frame || (this.consumed.has(index) && !marker.choice)) continue;
      if (marker.kind === "message" || marker.kind === "choice") {
        if (index === this.nextMessage()) element.append(this.messages!.view(index, this.messageText(marker.detail)));
        if (marker.choice) element.append(this.choicePicker(marker.choice, index));
      } else if (marker.branch && !marker.branch.known) {
        const select = document.createElement("select"); select.title = marker.detail;
        select.add(new Option(t.skipped, "0")); select.add(new Option(t.taken, "1")); select.value = marker.branch.taken ? "1" : "0";
        const branch = marker.branch;
        select.addEventListener("change", () => { this.answers.set(branch.key, select.value === "1"); try { this.calculate(); } catch (error) { this.app.state.setStatus(errorText(error), undefined, true); } });
        element.append(select);
      } else {
        const note = document.createElement("span"); note.textContent = marker.detail; element.append(note);
      }
    }
  }
  private messageText(label: string): string { return this.data?.messages.get(label.replace(/^@/, "")) ?? label; }
  /** タイムラインの印に添える答え（選択肢の答え、選び直せる分岐の進む・進まない）。 */
  private answerText(marker: PlaybackMarker): string | null {
    if (marker.choice) {
      const option = marker.choice.options?.find(o => o.value === marker.choice!.value);
      return option ? this.optionText(option.name) : String(marker.choice.value);
    }
    return marker.branch && !marker.branch.known ? (marker.branch.taken ? t.taken : t.skipped) : null;
  }
  private optionText(name: string): string { return name === "yes" ? t.yes : name === "no" ? t.no : this.messageText(name); }
  private choicePicker(choice: PlaybackChoiceMark, index: number): HTMLElement {
    const apply = (value: number): void => { try { this.choose(choice.key, value); } catch (error) { this.app.state.setStatus(errorText(error), undefined, true); } };
    if (choice.options) {
      const select = document.createElement("select"); select.title = t.choiceAnswer; select.dataset["autoId"] = `playback.choice.${index}`;
      for (const option of choice.options) select.add(new Option(this.optionText(option.name), String(option.value)));
      select.value = String(choice.value);
      select.addEventListener("change", () => apply(Number(select.value)));
      return select;
    }
    const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = String(CHOICE_CANCEL); input.step = "1";
    input.title = t.choiceNumber; input.value = String(choice.value); input.dataset["autoId"] = `playback.choice.${index}`;
    input.addEventListener("change", () => apply(Number(input.value)));
    return input;
  }
  private highlight(): void {
    if (!this.timeline || !this.clock) return;
    const spans: PlaybackHighlightSpan[] = [];
    for (const segment of this.timeline.segments) if (segment.start <= this.clock.frame && this.clock.frame <= segment.end) {
      spans.push(segment.command);
      if (segment.step && segment.movementPath) spans.push({ path: segment.movementPath, ...segment.step });
    }
    if (!spans.length) {
      const record = [...this.timeline.commands].reverse().find(record => record.frame <= this.clock!.frame);
      if (record) spans.push(record.command);
    }
    const key = JSON.stringify(spans);
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    void this.app.scriptHostIfLoaded().then(host => host?.playbackHighlight(spans)).catch(() => undefined);
  }
}

/** イベントのスクリプトが ROM のアドレス（0x08〜0x09）なら、その位置。 */
function eventRomPointer(map: OpenMap, target: ScriptTarget): number | null {
  const events = map.doc.events, index = target.index ?? 0;
  const sign = target.kind === "sign" ? events?.signs[index] : undefined;
  const pointer = target.kind === "person" ? events?.persons[index]?.script : target.kind === "trap" ? events?.traps[index]?.script : sign?.content.type === "script" ? sign.content.script : undefined;
  return pointer !== undefined && pointer >>> 24 >= 0x08 && pointer >>> 24 <= 0x09 ? pointer >>> 0 : null;
}
