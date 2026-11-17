import {
  buildPlaybackStart,
  defaultFacingOf,
  movementAction,
  movementName,
  movementTextTools,
  readApplyMovementLine,
  PATH_DEFAULT_WALK,
  PATH_WAIT_MAX,
  PathOps,
  pathOpValues,
  pathProblems,
  pathToMovement,
  pathWalkSpeeds,
  PLAYER_GRAPHICS,
  PLAYER_ID,
  stepsBetween,
  tracePath,
  walkOp,
  MOVEMENT_DIRECTIONS,
  type MovementDirection,
  type PathOp,
  type PathPoint,
  type PathProblem,
  type PlaybackActorState,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import type { MapView } from "../map/MapView";
import { drawPlaybackActors } from "../map/PlaybackActors";
import { actorSpriteSourceFor } from "../map/spriteCanvases";
import { createDialog, handleDialogKeys, pressable, type DialogFrame } from "../Dialog";
import { jaPathDraw as t } from "../../i18n/ja.pathDraw";
import { jaPlayback } from "../../i18n/ja.playback";
import { errorText } from "../../util/errors";
import { PlaybackProjectData } from "./PlaybackProject";
import { suggestPathLabel, writePath, type PathDrawMode, type PathDrawResult, type PathDrawTarget } from "./PathDrawWriter";
import "../../styles/pathDraw.css";

/** 窓を開くときの指定。 */
export interface PathDrawOptions {
  /** 動かす人物（localId。主人公は 0xFF）。省けば主人公。 */
  readonly actor?: number;
  /** 始めの位置と向き。省けば人物の置き場所（主人公は再生の始めの位置）。 */
  readonly start?: PathPoint;
  /** ほかの人物の居るマス（再生の途中から開いたとき）。省けばマップのイベントの位置。 */
  readonly occupied?: readonly { readonly x: number; readonly y: number }[];
  /** 置き換える先の `applymovement`（再生の途中・エディタの行から開いたとき。#518）。省けば新しいラベルで足す。 */
  readonly target?: PathDrawTarget | null;
}

/** 自動操作に返す窓の様子。 */
export interface PathDrawState {
  readonly open: boolean;
  readonly actor?: number;
  readonly start?: PathPoint;
  readonly end?: PathPoint;
  readonly speed?: number;
  readonly ops?: readonly PathOp[];
  readonly values?: readonly number[];
  readonly rows?: readonly string[];
  readonly problems?: readonly PathProblem[];
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly target?: PathDrawTarget | null;
  readonly mode?: PathDrawMode;
  readonly label?: string;
}

const ARROWS: Readonly<Record<string, MovementDirection>> = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" };

/**
 * 道をなぞって移動データを作る窓（#517）。メインの画面に浮かぶ小窓と、マップの上の下見（道の線・向きの矢印・終わりの位置の
 * 薄い人物）を持つ。開いている間だけ、マップの左ドラッグと矢印キーを受ける。閉じると重ね描きと受け口を外す。
 * 「ここで使う」で `.s` に書く（置き換えるか新しいラベルで足す。#518）。
 */
export class PathDrawPanel {
  private frame: DialogFrame | null = null;
  private readonly overlay = document.createElement("canvas");
  private host: MapView | null = null;
  private readonly ops = new PathOps();
  private actor = PLAYER_ID;
  private start: PathPoint = { x: 0, y: 0, facing: "down" };
  private occupiedOverride: readonly { x: number; y: number }[] | null = null;
  private speed = PATH_DEFAULT_WALK;
  private problems: PathProblem[] = [];
  private dragCell: { x: number; y: number } | null = null;
  private readonly fields = {
    actor: document.createElement("select"),
    x: document.createElement("input"),
    y: document.createElement("input"),
    facing: document.createElement("select"),
    speed: document.createElement("select"),
    wait: document.createElement("input"),
    list: document.createElement("ol"),
    warning: document.createElement("p"),
    count: document.createElement("span"),
    undo: document.createElement("button"),
    redo: document.createElement("button"),
    clear: document.createElement("button"),
    modeReplace: document.createElement("input"),
    modeNew: document.createElement("input"),
    replaceText: document.createElement("span"),
    label: document.createElement("input"),
    use: document.createElement("button"),
  };
  private target: PathDrawTarget | null = null;
  private writing: Promise<unknown> = Promise.resolve();
  private suggesting: Promise<unknown> = Promise.resolve();
  /** 閉じたとき（書き込みの入口 #518 が使う）。 */
  onClose: (() => void) | null = null;
  private readonly unlisten: (() => void)[] = [];

  constructor(private readonly app: App) {
    this.overlay.className = "path-draw-overlay";
    this.overlay.dataset["autoId"] = "pathDraw.overlay";
    app.state.on("map", () => this.close());
    app.state.on("session", () => this.close());
    for (const topic of ["tab", "view"] as const) app.state.on(topic, () => this.draw());
  }

  get isOpen(): boolean { return this.frame !== null; }
  /** 窓の本体（#518 が「ここで使う」の欄を足す）。 */
  get body(): HTMLElement | null { return this.frame?.body ?? null; }
  /** 作った移動コマンドの値（`end_m` を含まない）。 */
  get values(): number[] { return pathToMovement(this.ops.ops); }
  get actorId(): number { return this.actor; }

  open(options: PathDrawOptions = {}): void {
    const map = this.app.state.map;
    if (!map) throw new Error(t.noMap);
    const persons = map.doc.events?.persons ?? [];
    const actor = options.actor ?? PLAYER_ID;
    if (actor !== PLAYER_ID && !options.start && !persons.some(p => p.localId === actor)) throw new Error(t.noActor(actor));
    this.close();
    this.actor = actor;
    this.occupiedOverride = options.occupied ?? null;
    this.start = options.start ?? this.defaultStart(actor);
    this.target = options.target ?? null;
    this.ops.reset();
    this.build();
    this.listen();
    this.refresh();
    const label = this.fields.label;
    label.value = "";
    const frame = this.frame;
    this.suggesting = suggestPathLabel(this.app, actor).then(name => { if (this.frame === frame && label.value === "") label.value = name; }).catch(() => undefined);
  }

  /**
   * スクリプトの `applymovement` の行（0 始まり）から開く（#518）。その移動データを置き換える先にし、動かす人物は行の 1 つ目の
   * 引数（このマップの人物でなければ主人公）。
   */
  async openFromLine(path: string, line: number): Promise<void> {
    const map = this.app.state.map;
    if (!map) throw new Error(t.noMap);
    const loaded = await this.app.scripts.files.read(path);
    const parsed = loaded ? readApplyMovementLine(loaded.text.split(/\r?\n/)[line] ?? "") : null;
    if (!parsed) throw new Error(t.notApplyMovement);
    const data = await PlaybackProjectData.load(this.app);
    const value = movementTextTools(data.project).resolve(parsed.actor);
    const actor = value !== null && (map.doc.events?.persons ?? []).some(p => p.localId === value) ? value : PLAYER_ID;
    this.open({ actor, target: { commandPath: path, commandLine: line, label: parsed.label } });
  }

  /** 書き込みの名前の案を待つ（自動操作）。 */
  async ready(): Promise<void> {
    await this.suggesting;
    await this.writing.catch(() => undefined);
  }

  /** 「ここで使う」。mode・label を省けば窓の選択。 */
  apply(options: { mode?: PathDrawMode; label?: string; shared?: "rewrite" | "copy" } = {}): Promise<PathDrawResult | null> {
    const mode = options.mode ?? (this.fields.modeReplace.checked ? "replace" : "new");
    const label = options.label ?? this.fields.label.value;
    const run = writePath(this.app, this.values, { mode, target: this.target, label, actor: this.actor, ...(options.shared ? { shared: options.shared } : {}) });
    this.writing = run.catch(() => undefined);
    return run;
  }

  close(): void {
    if (!this.frame) return;
    for (const off of this.unlisten.splice(0)) off();
    this.frame.remove(); this.frame = null;
    this.overlay.remove(); this.overlay.width = 0; this.overlay.height = 0; this.host = null;
    this.dragCell = null;
    this.onClose?.();
  }

  state(): PathDrawState {
    if (!this.frame) return { open: false };
    const trace = tracePath(this.start, this.ops.ops);
    return {
      open: true, actor: this.actor, start: this.start, end: trace.end, speed: this.speed,
      target: this.target, mode: this.fields.modeReplace.checked ? "replace" : "new", label: this.fields.label.value,
      ops: this.ops.ops, values: this.values, rows: this.ops.ops.map(op => this.rowText(op)), problems: this.problems,
      canUndo: this.ops.canUndo, canRedo: this.ops.canRedo,
    };
  }

  /** 1 歩（向きだけなら face）。 */
  step(direction: MovementDirection, faceOnly = false): void {
    const op: PathOp | null = faceOnly ? { kind: "face", direction } : walkOp(direction, this.speed);
    if (op) { this.ops.push(op); this.refresh(); }
  }
  /** 今の終わりから (x, y) までの歩きを足す（横を先に、次に縦）。 */
  stepTo(x: number, y: number): void {
    const end = tracePath(this.start, this.ops.ops).end;
    const ops = stepsBetween(end, { x, y }).map(d => walkOp(d, this.speed)!);
    if (ops.length) { this.ops.push(...ops); this.refresh(); }
  }
  addWait(frames: number): void {
    if (!Number.isInteger(frames) || frames < 1 || frames > PATH_WAIT_MAX) throw new RangeError(t.waitRange(PATH_WAIT_MAX));
    this.ops.push({ kind: "wait", frames }); this.refresh();
  }
  undo(): void { if (this.ops.undo()) this.refresh(); }
  redo(): void { if (this.ops.redo()) this.refresh(); }
  clear(): void { this.ops.clear(); this.refresh(); }
  setSpeed(value: number): void { if (pathWalkSpeeds().includes(value)) { this.speed = value; this.fields.speed.value = String(value); } }
  setStart(patch: Partial<PathPoint>): void {
    this.start = { ...this.start, ...patch };
    this.refresh();
  }
  setActor(actor: number): void {
    if (actor === this.actor) return;
    this.actor = actor; this.occupiedOverride = null;
    this.start = this.defaultStart(actor);
    this.refresh();
  }

  // ---- 窓 ----

  private build(): void {
    const frame = createDialog({ title: t.title, modal: false, className: "path-draw", width: 320, onClose: () => this.close() });
    this.frame = frame;
    // 右のイベントの欄を隠さないよう、左の木の上に出す（タイトルの帯で動かせる）
    frame.box.style.left = "12px"; frame.box.style.top = "110px";
    const f = this.fields, map = this.app.state.map!;
    f.actor.replaceChildren(new Option(t.player, String(PLAYER_ID)));
    (map.doc.events?.persons ?? []).forEach((p, i) => f.actor.add(new Option(jaPlayback.personName(i + 1, p.localId), String(p.localId))));
    // 再生の途中から開いた、マップのイベントに無い人物（連れ歩きなど）
    if (![...f.actor.options].some(o => o.value === String(this.actor))) f.actor.add(new Option(jaPlayback.personName(null, this.actor), String(this.actor)));
    f.actor.dataset["autoId"] = "pathDraw.actor";
    f.actor.onchange = () => this.setActor(Number(f.actor.value));
    for (const [input, id] of [[f.x, "x"], [f.y, "y"]] as const) {
      input.type = "number"; input.min = "0"; input.step = "1"; input.className = "path-draw-number"; input.dataset["autoId"] = `pathDraw.${id}`;
      input.onchange = () => { const v = Number(input.value); if (Number.isInteger(v)) this.setStart(id === "x" ? { x: v } : { y: v }); };
    }
    f.facing.replaceChildren(...MOVEMENT_DIRECTIONS.map(d => new Option(jaPlayback.direction[d], d)));
    f.facing.dataset["autoId"] = "pathDraw.facing";
    f.facing.onchange = () => this.setStart({ facing: f.facing.value as MovementDirection });
    f.speed.replaceChildren(...pathWalkSpeeds().map(id => new Option(`${movementName(id).replace(/_down/, "_*")}: ${jaPlayback.movementMotion(movementAction(id))}`, String(id))));
    f.speed.value = String(this.speed); f.speed.dataset["autoId"] = "pathDraw.speed";
    f.speed.onchange = () => this.setSpeed(Number(f.speed.value));
    f.wait.type = "number"; f.wait.min = "1"; f.wait.max = String(PATH_WAIT_MAX); f.wait.value = "16"; f.wait.className = "path-draw-number"; f.wait.dataset["autoId"] = "pathDraw.waitFrames";
    const addWait = button(t.addWait, "pathDraw.addWait", () => {
      try { this.addWait(Number(f.wait.value)); } catch (error) { this.app.state.setStatus((error as Error).message, undefined, true); }
    });
    f.undo = button(t.undo, "pathDraw.undo", () => this.undo());
    f.redo = button(t.redo, "pathDraw.redo", () => this.redo());
    f.clear = button(t.clear, "pathDraw.clear", () => this.clear());
    f.list.className = "path-draw-list"; f.list.dataset["autoId"] = "pathDraw.list";
    f.warning.className = "path-draw-warning"; f.warning.dataset["autoId"] = "pathDraw.warning";
    f.count.dataset["autoId"] = "pathDraw.count";
    const hint = document.createElement("p"); hint.className = "path-draw-hint"; hint.textContent = t.hint;
    // 書き込み（#518）
    for (const [radio, id] of [[f.modeReplace, "modeReplace"], [f.modeNew, "modeNew"]] as const) {
      radio.type = "radio"; radio.name = "path-draw-mode"; radio.dataset["autoId"] = `pathDraw.${id}`;
    }
    f.modeReplace.disabled = this.target === null;
    f.modeReplace.checked = this.target !== null; f.modeNew.checked = this.target === null;
    f.replaceText.textContent = this.target ? t.modeReplace(this.target.label) : t.modeReplaceNone;
    f.label.type = "text"; f.label.className = "path-draw-label"; f.label.dataset["autoId"] = "pathDraw.label"; f.label.spellcheck = false;
    f.label.addEventListener("focus", () => { f.modeNew.checked = true; });
    f.use = button(t.use, "pathDraw.apply", () => {
      void this.apply().catch(error => this.app.state.setStatus(errorText(error), undefined, true));
    });
    const replaceRow = document.createElement("label"); replaceRow.className = "path-draw-mode"; replaceRow.append(f.modeReplace, f.replaceText);
    const newRow = document.createElement("label"); newRow.className = "path-draw-mode"; newRow.append(f.modeNew, t.modeNew, f.label);
    const write = document.createElement("fieldset"); write.className = "path-draw-write";
    write.append(replaceRow, newRow, buttons(f.use));
    frame.body.append(
      row(t.actor, f.actor),
      row(t.start, f.x, f.y, f.facing),
      row(t.speed, f.speed),
      row(t.wait, f.wait, addWait),
      f.list, f.count, f.warning,
      buttons(f.undo, f.redo, f.clear),
      write,
      hint,
    );
    handleDialogKeys(frame, null, e => this.key(e));
    frame.register({ title: t.title, text: t.hint, ...pressable([
      { label: t.undo, aliases: ["undo"], run: () => this.undo() },
      { label: t.redo, aliases: ["redo"], run: () => this.redo() },
      { label: t.clear, aliases: ["clear"], run: () => this.clear() },
      { label: t.close, aliases: ["close"], run: () => this.close() },
      { label: t.use, aliases: ["apply"], run: () => { void this.apply().catch(error => this.app.state.setStatus(errorText(error), undefined, true)); } },
    ]) });
  }

  private refresh(): void {
    if (!this.frame) return;
    const f = this.fields, map = this.app.state.map;
    f.actor.value = String(this.actor);
    f.x.value = String(this.start.x); f.y.value = String(this.start.y); f.facing.value = this.start.facing;
    if (map) { f.x.max = String(map.doc.width - 1); f.y.max = String(map.doc.height - 1); }
    this.problems = map ? pathProblems(this.start, this.ops.ops, {
      width: map.doc.width, height: map.doc.height,
      movementAt: (x, y) => map.doc.grid.getMovement(x, y),
      occupied: this.occupied(),
    }) : [];
    const bad = new Set(this.problems.map(p => p.index));
    f.list.replaceChildren(...this.ops.ops.map((op, i) => {
      const li = document.createElement("li"); li.textContent = this.rowText(op);
      const problem = this.problems.find(p => p.index === i);
      if (problem) { li.classList.add("blocked"); li.title = t.reason[problem.reason]; }
      return li;
    }));
    if (this.ops.ops.length === 0) { const li = document.createElement("li"); li.className = "empty"; li.textContent = t.empty; f.list.append(li); }
    f.list.lastElementChild?.scrollIntoView({ block: "nearest" });
    f.count.textContent = t.count(this.values.length);
    f.warning.textContent = bad.size ? t.blocked(bad.size) : "";
    f.warning.hidden = bad.size === 0;
    f.use.disabled = this.ops.ops.length === 0;
    f.undo.disabled = !this.ops.canUndo; f.redo.disabled = !this.ops.canRedo; f.clear.disabled = !this.ops.canUndo;
    this.draw();
  }

  private rowText(op: PathOp): string {
    const names = pathOpValues(op).map(v => movementName(v));
    return op.kind === "wait" ? t.waitRow(op.frames, names.join(", ")) : names.join(", ");
  }

  // ---- 入力 ----

  private listen(): void {
    const onKey = (e: KeyboardEvent): void => {
      if (!this.frame || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, select, textarea, [contenteditable=true]")) return;
      // ほかのダイアログ（確認など）が前にあるときは受けない
      if (document.querySelector(".dialog-overlay")) return;
      if (target && this.frame.box.contains(target) && e.key === "Escape") return;
      if (this.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", onKey, true);
    this.unlisten.push(() => window.removeEventListener("keydown", onKey, true));
    for (const view of this.views()) {
      const down = (e: PointerEvent): void => {
        if (!this.frame || e.button !== 0 || !view.cellAtAny(e)) return;
        e.preventDefault(); e.stopPropagation();
        const cell = view.rawCellAt(e);
        this.dragCell = cell; this.stepTo(cell.x, cell.y);
        const move = (m: PointerEvent): void => {
          const c = view.rawCellAt(m);
          if (this.dragCell && (c.x !== this.dragCell.x || c.y !== this.dragCell.y)) { this.dragCell = c; this.stepTo(c.x, c.y); }
        };
        const up = (): void => { this.dragCell = null; window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); };
        window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true);
      };
      // マップの道具（描く・イベントを動かす）より先に受ける
      const swallow = (e: MouseEvent): void => { if (this.frame && e.button === 0 && view.cellAtAny(e)) e.stopPropagation(); };
      view.element.addEventListener("pointerdown", down, true);
      view.element.addEventListener("mousedown", swallow, true);
      view.element.classList.add("path-drawing");
      this.unlisten.push(() => {
        view.element.removeEventListener("pointerdown", down, true);
        view.element.removeEventListener("mousedown", swallow, true);
        view.element.classList.remove("path-drawing");
      });
    }
  }

  /** 窓とマップの上のキー。扱ったら true。 */
  private key(e: KeyboardEvent): boolean {
    const direction = ARROWS[e.key];
    if (direction === "right" && e.shiftKey && !e.ctrlKey && !e.altKey) { this.redo(); return true; }
    if (direction && !e.shiftKey && !e.altKey) { this.step(direction, e.ctrlKey); return true; }
    if (e.key === "Backspace" && !e.ctrlKey && !e.altKey && !e.shiftKey) { this.undo(); return true; }
    return false;
  }

  // ---- 下見 ----

  private views(): MapView[] { return [this.app.tabs.map.view, this.app.tabs.movement.view, this.app.tabs.event.view]; }

  private draw(): void {
    if (!this.frame) return;
    const map = this.app.state.map, tab = this.app.state.tab;
    const view = tab === "map" || tab === "movement" || tab === "event" ? this.app.tabs[tab].view : null;
    if (!map || !view) { this.overlay.remove(); this.host = null; return; }
    if (view !== this.host) { this.host = view; view.stage.append(this.overlay); }
    const size = view.cellSize, width = map.doc.width * size, height = map.doc.height * size, origin = view.originPx;
    Object.assign(this.overlay.style, { left: `${origin.x}px`, top: `${origin.y}px`, width: `${width}px`, height: `${height}px` });
    if (this.overlay.width !== width || this.overlay.height !== height) { this.overlay.width = width; this.overlay.height = height; }
    const c = this.overlay.getContext("2d")!;
    c.clearRect(0, 0, width, height);
    const trace = tracePath(this.start, this.ops.ops);
    const bad = new Set(this.problems.map(p => p.index));
    const center = (p: { x: number; y: number }) => ({ x: (p.x + 0.5) * size, y: (p.y + 0.5) * size });
    const line = Math.max(2, size / 6);
    // 終わりの位置の薄い人物（再生の人物の描き方）
    const source = actorSpriteSourceFor(this.app.state.session, map.doc.header.mapType);
    const graphicsId = this.actor === PLAYER_ID ? PLAYER_GRAPHICS[this.app.state.settings.data.playbackGender === "female" ? "female" : "male"] : (map.doc.events?.persons.find(p => p.localId === this.actor)?.graphicsId ?? -1);
    if (source && graphicsId >= 0) {
      c.save(); c.globalAlpha = 0.55; c.scale(size / 16, size / 16);
      drawPlaybackActors(c, [ghost(this.actor, graphicsId, trace.end)], source);
      c.restore();
    }
    // 始めの位置
    const s = center(this.start);
    c.lineWidth = line; c.strokeStyle = "#2060ff"; c.fillStyle = "rgba(32, 96, 255, 0.25)";
    c.beginPath(); c.arc(s.x, s.y, size * 0.35, 0, Math.PI * 2); c.fill(); c.stroke();
    // 道の線と向きの矢印（通れないマスへの歩きは赤）
    c.lineCap = "round";
    trace.steps.forEach((step, i) => {
      const a = center(step.from), b = center(step.to);
      const color = bad.has(i) ? "#e00000" : "#2060ff";
      if (step.op.kind === "walk") {
        c.strokeStyle = color; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        arrow(c, b, step.op.direction, size * 0.22, color);
      } else if (step.op.kind === "face") arrow(c, a, step.op.direction, size * 0.3, "#ff9000");
      else { c.fillStyle = "#ff9000"; c.beginPath(); c.arc(a.x, a.y, size * 0.12, 0, Math.PI * 2); c.fill(); }
    });
    arrow(c, center(trace.end), trace.end.facing, size * 0.3, "#20a040");
  }

  private defaultStart(actor: number): PathPoint {
    const map = this.app.state.map!, events = map.doc.events ?? { persons: [], warps: [], traps: [], signs: [] };
    if (actor !== PLAYER_ID) {
      const p = events.persons.find(person => person.localId === actor)!;
      return { x: p.x, y: p.y, facing: defaultFacingOf(p.movementType) };
    }
    const placed = this.app.previewPlayer.player;
    const start = buildPlaybackStart({ events, trigger: { kind: "map" }, gender: "male", provisionalPlayer: placed });
    return { ...start.player };
  }

  private occupied(): { x: number; y: number }[] {
    if (this.occupiedOverride) return [...this.occupiedOverride];
    const map = this.app.state.map;
    const out = (map?.doc.events?.persons ?? []).filter(p => p.localId !== this.actor).map(p => ({ x: p.x, y: p.y }));
    const player = this.app.previewPlayer.player;
    if (this.actor !== PLAYER_ID && player) out.push({ x: player.x, y: player.y });
    return out;
  }
}

function ghost(id: number, graphicsId: number, at: PathPoint): PlaybackActorState {
  return {
    id, graphicsId, tileX: at.x, tileY: at.y, pixelX: at.x * 16, pixelY: at.y * 16, height: 0, facing: at.facing, sprite: "stand",
    actionFrame: 0, movementId: null, visible: true, present: true, shadow: false, mark: null, elevation: 0, fixedPriority: false, animHold: false,
  };
}

function arrow(c: CanvasRenderingContext2D, at: { x: number; y: number }, direction: MovementDirection, length: number, color: string): void {
  const angle = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[direction];
  c.save(); c.translate(at.x, at.y); c.rotate(angle); c.fillStyle = color;
  c.beginPath(); c.moveTo(length, 0); c.lineTo(-length * 0.5, -length * 0.7); c.lineTo(-length * 0.5, length * 0.7); c.closePath(); c.fill();
  c.restore();
}

function button(text: string, id: string, run: () => void): HTMLButtonElement {
  const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.dataset["autoId"] = id; b.addEventListener("click", run); return b;
}
function row(label: string, ...items: HTMLElement[]): HTMLElement {
  const div = document.createElement("div"); div.className = "path-draw-row";
  const span = document.createElement("span"); span.textContent = label;
  div.append(span, ...items); return div;
}
function buttons(...items: HTMLElement[]): HTMLElement {
  const div = document.createElement("div"); div.className = "path-draw-buttons"; div.append(...items); return div;
}
