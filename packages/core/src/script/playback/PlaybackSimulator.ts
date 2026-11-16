import type { ScriptCommandTable } from "../commands/ScriptCommandTable.js";
import { PLAYER_SCREEN_ORIGIN } from "../../render/ViewportFrame.js";
import type { ScriptIndex } from "../index/ScriptIndex.js";
import { MOVEMENT_DIRECTIONS, MOVEMENT_END, movementAction, oppositeDirection, type MovementAction, type MovementDirection } from "../movement/MovementActionTable.js";
import { readMovementBlock, type MovementBlock, type MovementStep } from "../movement/MovementBlock.js";
import {
  defaultPlaybackHandlers,
  VAR_LASTRESULT,
  type PlaybackHandlerContext,
  type PlaybackHandlerTable,
} from "./handlers/PlaybackHandlers.js";
import {
  CAMERA_ID,
  PLAYER_ID,
  sourceOf,
  type PlaybackChoiceMark,
  type PlaybackChoiceOption,
  type PlaybackCommandRecord,
  type PlaybackMarker,
  type PlaybackMarkerKind,
  type PlaybackSegment,
  type PlaybackSource,
} from "./PlaybackState.js";
import { ScriptWalker, type WalkCommand, type WalkEvent, type WalkLocation } from "./ScriptWalker.js";
import { applyStepFrame, Timeline, type ActorBase, type ActorChange, type CameraChange, type ShakeSpan, type StepContext } from "./Timeline.js";

/**
 * 再生の計算（#451）。たどった命令（{@link ScriptWalker}）を、ゲームと同じ順で 1 フレームずつ進め、タイムラインを作る。
 *
 * 1 フレームの順（`fld_main.c` の `FieldMainCore`）: 1. スクリプト（待つ命令に当たるまで何個でも進む）→ 2. 移動データを人物に渡す
 * → 3. 人物を動かす → 4. 画面。
 *
 * フレームの決まり（research_A の 4.3。ソースの読みだけで、エミュレータでは確かめていない）:
 * - `applymovement` をフレーム F で実行すると、同じ F に 1 歩目が動く。命令の間に空きは無い（t で終われば次は t+1）。
 * - 最後の命令が t_end で終わると、t_end+1 で `end_m` を読み、`waitmovement` は t_end+2 で終わりに気づき、次の命令は t_end+3。
 *   命令の合計が T フレームなら、`waitmovement` の次の命令は F+T+2。
 * - `wait n` を s で実行すると、次の命令は s+n+1（`wait 0` は 65536 フレーム）。
 * - 待つ命令から戻ったフレームは、続きを実行しない（次のフレームから）。
 * - すでに動いている人物（移動データを読み終えていない人物）への `applymovement` は黙って無視される。
 * - 人物の自分の動き（移動タイプ）は止める（A-5）。
 * - 文・選択肢は長さ 0 の印（A-3。画面の側で止まる）。
 * - 条件分岐は、値の分かる比べ方なら計算し、分からなければ答えの表、無ければ「飛ばない」（A-2）。
 */

/** 再生に使うプロジェクトの部品。 */
export interface PlaybackProject {
  readonly index: ScriptIndex;
  readonly commands: ScriptCommandTable;
  readonly text: (path: string) => string | null;
}

/** 始めに居る人物。 */
export interface PlaybackActorInit {
  readonly id: number;
  readonly graphicsId: number;
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
  readonly facing: MovementDirection;
  /** 移動タイプの基本の向き（`face_default` と `showobject` で使う）。 */
  readonly defaultFacing: MovementDirection;
  /** 始めにマップに居るか（既定 true）。 */
  readonly present?: boolean;
  /** 出現のフラグ（`hidesprite` で立てる）。無ければ 0。 */
  readonly flag?: number;
}

/** 再生の始めの状態（#453 の {@link import("./StartState.js").buildPlaybackStart} が作る）。 */
export interface PlaybackStart {
  /** 人物。主人公（0xFF）を含む。 */
  readonly actors: readonly PlaybackActorInit[];
  /** 話しかけた人物（`faceplayer` の相手）。無ければ null。 */
  readonly talker: number | null;
  /** 始めから分かっている変数の値。 */
  readonly vars?: ReadonlyMap<number, number>;
  /** 始めから分かっているフラグ。 */
  readonly flags?: ReadonlyMap<number, boolean>;
}

/** 計算の設定。 */
export interface PlaybackOptions {
  readonly project: PlaybackProject;
  /** 始めのラベルか場所。 */
  readonly entry: string | WalkLocation;
  readonly start: PlaybackStart;
  /** 分岐の答え（`Timeline.markers` の branch.key → 飛ぶか）。 */
  readonly answers?: ReadonlyMap<string, boolean>;
  /** 選択肢の答え（`Timeline.markers` の choice.key → LASTRESULT の値）。無い所は既定（はい・既定の項目・上）。 */
  readonly choices?: ReadonlyMap<string, number>;
  readonly handlers?: PlaybackHandlerTable;
  /** フレームの上限。既定 3,600（60 秒）。 */
  readonly maxFrames?: number;
  /** 命令の数の上限。既定 10,000。 */
  readonly maxCommands?: number;
  /** ROM のアドレスの移動データ（素の ROM の再生、#459）。無ければ印を出して動かさない。 */
  readonly romMovement?: (pointer: number) => MovementBlock | null;
  /** マップの高さ（移動許可の値 >> 2）。0は自由、15は前の優先順位を保持。 */
  readonly elevationAt?: (x: number, y: number) => number | null;
}

/** フレームの上限の既定（60 秒）。 */
export const PLAYBACK_MAX_FRAMES = 3600;

/** 比べた結果（0 小さい、1 同じ、2 大きい）。 */
type CompareResult = 0 | 1 | 2;
/** 条件の表（`sScriptConditionTable`。lt, eq, gt, le, ge, ne の順に、結果 0・1・2 で成り立つか）。 */
const CONDITIONS: readonly (readonly [boolean, boolean, boolean])[] = [
  [true, false, false],
  [false, true, false],
  [false, false, true],
  [true, true, false],
  [false, true, true],
  [true, false, true],
];

/** はい・いいえ（LASTRESULT は はい 1、いいえ 0）。 */
const YES_NO: readonly PlaybackChoiceOption[] = [{ value: 1, name: "yes" }, { value: 0, name: "no" }];

/** 向きの番号（`changeface` の 1 下、2 上、3 左、4 右）。 */
function directionFromCode(code: number | null): MovementDirection | null {
  return code !== null && code >= 1 && code <= 4 ? MOVEMENT_DIRECTIONS[code - 1]! : null;
}

/** 向きの番号（1〜4）。 */
export function directionCode(d: MovementDirection): number {
  return MOVEMENT_DIRECTIONS.indexOf(d) + 1;
}

interface ActorMovement {
  readonly values: readonly number[];
  readonly steps: readonly (MovementStep | null)[];
  index: number;
  readonly label: string;
  readonly path: string | null;
  readonly command: PlaybackSource;
  /** end_m を読んだフレーム。読み終えていなければ null。 */
  finished: number | null;
}

interface ActiveStep {
  readonly action: MovementAction;
  readonly start: number;
  readonly base: ActorBase;
  readonly ctx: StepContext;
}

interface SimActor {
  readonly id: number;
  readonly init: PlaybackActorInit;
  base: ActorBase;
  movement: ActorMovement | null;
  current: ActiveStep | null;
  readonly changes: ActorChange[];
  readonly marks: { frame: number; mark: string; frames: number }[];
}

type Wait = { type: "movement"; actor: number; since: number } | { type: "state"; since: number } | { type: "frames"; resume: number };

/** たどって計算する。 */
export function simulatePlayback(options: PlaybackOptions): Timeline {
  return new Simulator(options).run();
}

class Simulator {
  private readonly actors = new Map<number, SimActor>();
  private readonly vars = new Map<number, number | null>();
  private readonly flags = new Map<number, boolean>();
  private readonly segments: PlaybackSegment[] = [];
  private readonly markers: PlaybackMarker[] = [];
  private readonly records: PlaybackCommandRecord[] = [];
  private readonly cameraChanges: CameraChange[] = [];
  private readonly shakes: ShakeSpan[] = [];
  private readonly walker: ScriptWalker;
  private readonly handlers: PlaybackHandlerTable;
  private compare: CompareResult | null = null;
  private lastText = "";
  private lastMoved = PLAYER_ID;
  private camera: { target: number; offsetX: number; offsetY: number } = { target: PLAYER_ID, offsetX: 0, offsetY: 0 };
  /** waitstate が待つ、揺れなどの終わりのフレーム（含まない）。 */
  private stateEnd = 0;
  private frame = 0;
  private scriptDone = false;
  private wait: Wait | null = null;
  /** 待ちから戻って、次に続きを実行するフレーム。 */
  private resumeAt = 0;

  constructor(private readonly options: PlaybackOptions) {
    this.walker = new ScriptWalker({
      index: options.project.index,
      commands: options.project.commands,
      text: options.project.text,
      ...(options.maxCommands !== undefined ? { maxCommands: options.maxCommands } : {}),
    });
    this.handlers = options.handlers ?? defaultPlaybackHandlers("nd");
    for (const a of options.start.actors) this.addActor(a);
    for (const [k, v] of options.start.vars ?? []) this.vars.set(k, v);
    for (const [k, v] of options.start.flags ?? []) this.flags.set(k, v);
  }

  private addActor(a: PlaybackActorInit): SimActor {
    const base: ActorBase = {
      graphicsId: a.graphicsId,
      tileX: a.x,
      tileY: a.y,
      pixelX: a.x * 16,
      pixelY: a.y * 16,
      facing: a.facing,
      visible: a.present !== false,
      present: a.present !== false,
      lockFacing: false,
      animHold: false,
      fixedPriority: false,
      height: 0,
      elevation: a.elevation,
    };
    const sim: SimActor = { id: a.id, init: a, base, movement: null, current: null, changes: [], marks: [] };
    this.actors.set(a.id, sim);
    return sim;
  }

  run(): Timeline {
    const max = this.options.maxFrames ?? PLAYBACK_MAX_FRAMES;
    if (typeof this.options.entry === "string") this.walker.start(this.options.entry);
    else this.walker.startAt(this.options.entry);
    let last = 0;
    for (this.frame = 0; this.frame < max; this.frame++) {
      const f = this.frame;
      this.scriptPhase();
      this.movementPhase();
      this.actorPhase();
      last = f;
      if (this.scriptDone && this.idle() && f + 1 >= this.stateEnd) break;
      if (f === max - 1) this.marker("limit", null, `${max} フレームで打ち切り`);
    }
    const tracks = [...this.actors.values()]
      .sort((a, b) => a.id - b.id)
      .map((a) => ({ id: a.id, initial: this.initialOf(a), changes: a.changes, marks: a.marks }));
    this.markers.sort((a, b) => a.frame - b.frame);
    this.segments.sort((a, b) => a.start - b.start || a.actor - b.actor);
    return new Timeline(tracks, this.segments, this.markers, this.records, this.cameraChanges, this.shakes, last);
  }

  private readonly initials = new Map<number, ActorBase>();

  private initialOf(a: SimActor): ActorBase {
    return this.initials.get(a.id) ?? a.base;
  }

  private idle(): boolean {
    for (const a of this.actors.values()) if (a.current || (a.movement && a.movement.finished === null)) return false;
    return true;
  }

  // ---- 1. スクリプト ----

  private scriptPhase(): void {
    if (this.scriptDone) return;
    const f = this.frame;
    if (this.wait) {
      const w = this.wait;
      let done = false;
      if (w.type === "frames") done = f >= w.resume;
      else if (f > w.since) {
        if (w.type === "movement") {
          const a = this.actors.get(w.actor);
          done = !a || !a.movement || (a.movement.finished !== null && a.movement.finished < f);
        } else {
          done = f >= this.stateEnd;
        }
      }
      if (!done) return;
      this.wait = null;
      // wait n は s+n+1 で続きを実行する（resume のフレームそのもの）。ほかは気づいた次のフレームから。
      if (w.type !== "frames") {
        this.resumeAt = f + 1;
        return;
      }
    }
    if (f < this.resumeAt) return;
    for (;;) {
      const e = this.walker.next((cmd, key, visit) => this.decide(cmd, key, visit));
      if (!this.handleEvent(e)) return;
    }
  }

  /** 1 件を処理する。続けて次の命令を実行するなら true。 */
  private handleEvent(e: WalkEvent): boolean {
    if (e.type === "stop") {
      this.scriptDone = true;
      this.marker(e.reason === "limit" ? "limit" : "stop", e.path === null ? null : { path: e.path, line: e.line ?? 0, start: 0, end: 0, part: 0 }, e.reason + (e.detail ? ` ${e.detail}` : ""));
      return false;
    }
    if (e.type === "warning") {
      this.marker("warning", { path: e.path, line: e.line, start: 0, end: 0, part: 0 }, `${e.kind} ${e.detail}`);
      return true;
    }
    const cmd = e.command;
    this.records.push({ frame: this.frame, command: cmd });
    return this.execute(cmd);
  }

  private decide(cmd: WalkCommand, key: string, visit: number): boolean {
    const cond = cmd.args[0]?.value ?? null;
    const answerKey = `${key}#${visit}`;
    let taken: boolean;
    let known = false;
    if (this.compare !== null && cond !== null && cond >= 0 && cond < CONDITIONS.length) {
      taken = CONDITIONS[cond]![this.compare];
      known = true;
    } else {
      taken = this.options.answers?.get(answerKey) ?? false;
    }
    const target = cmd.args[1]?.text ?? "";
    this.markers.push({ frame: this.frame, kind: "branch", source: sourceOf(cmd), detail: target, branch: { key: answerKey, taken, known, target } });
    return taken;
  }

  private varValue(id: number | null): number | null {
    if (id === null) return null;
    if (id >= 0x4000 && id <= 0x40ff) return this.vars.get(id) ?? null;
    if (id >= 0x8000 && id <= 0x80ff) return this.vars.get(id) ?? null;
    return this.vars.has(id) ? (this.vars.get(id) ?? null) : null;
  }

  /** 値の引数（変数の番号なら中身）。 */
  private valueOf(v: number | null): number | null {
    if (v === null) return null;
    return v >= 0x4000 ? this.varValue(v) : v;
  }

  private compareValues(a: number | null, b: number | null): CompareResult | null {
    if (a === null || b === null) return null;
    return a < b ? 0 : a === b ? 1 : 2;
  }

  /** 命令を実行する。続けて次の命令を実行するなら true（待つ命令なら false）。 */
  private execute(cmd: WalkCommand): boolean {
    const f = this.frame;
    const arg = (i: number) => cmd.args[i]?.value ?? null;
    const src = sourceOf(cmd);
    switch (cmd.opcode) {
      case 0x09: {
        // callstd: msgbox の型。5 ははい・いいえ（MSG_YESNO）。
        const type = arg(0);
        if (type === 5) {
          this.choice(src, this.lastText, "yesno", YES_NO, 1);
        } else {
          this.marker("message", src, this.lastText);
        }
        return true;
      }
      case 0x0f:
        this.lastText = cmd.args[1]?.text ?? "";
        return true;
      case 0x67: {
        // msg 0x0 などのバンクの番号なら、前の loadpointer の文（ND・Chronos の書き方）。
        const text = cmd.args[0]?.text ?? "";
        this.marker("message", src, /^(0x)?[0-3]$/i.test(text.trim()) ? this.lastText || text : text);
        return true;
      }
      case 0x16:
        this.setVar(arg(0), this.valueOf(arg(1)) ?? (arg(1) !== null && arg(1)! < 0x4000 ? arg(1) : null));
        return true;
      case 0x17:
      case 0x18: {
        const cur = this.varValue(arg(0));
        const d = arg(1);
        this.setVar(arg(0), cur === null || d === null ? null : (cur + (cmd.opcode === 0x17 ? d : -d)) & 0xffff);
        return true;
      }
      case 0x19:
        this.setVar(arg(0), this.varValue(arg(1)));
        return true;
      case 0x1a:
        this.setVar(arg(0), this.valueOf(arg(1)));
        return true;
      case 0x21:
        this.compare = this.compareValues(this.varValue(arg(0)), this.valueOf(arg(1)));
        return true;
      case 0x22:
        this.compare = this.compareValues(this.varValue(arg(0)), this.varValue(arg(1)));
        return true;
      case 0x1b:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x1f:
      case 0x20:
        this.compare = null;
        return true;
      case 0x29:
      case 0x2a:
        if (arg(0) !== null) this.flags.set(arg(0)!, cmd.opcode === 0x29);
        return true;
      case 0x2b: {
        const flag = arg(0);
        const v = flag === null ? undefined : this.flags.get(flag);
        this.compare = v === undefined ? null : v ? 1 : 0;
        return true;
      }
      case 0x23:
      case 0x24: {
        const name = cmd.args[0]?.text ?? "";
        const h = this.handlers.callasm.get(name);
        if (h) h.run(this.context(src), cmd);
        else {
          this.marker("unhandled", src, `callasm ${name}`);
          this.vars.set(VAR_LASTRESULT, null);
        }
        return true;
      }
      case 0x25:
      case 0x26: {
        const num = cmd.opcode === 0x25 ? arg(0) : arg(1);
        const h = num === null ? undefined : this.handlers.special.get(num);
        if (h) h.run(this.context(src), cmd);
        else this.marker("unhandled", src, `special 0x${(num ?? 0).toString(16).toUpperCase()}`);
        if (cmd.opcode === 0x26 && !h) this.setVar(arg(0), null);
        return true;
      }
      case 0x27:
        this.wait = { type: "state", since: f };
        return false;
      case 0x28: {
        const n = arg(0) === 0 ? 65536 : (arg(0) ?? 0);
        this.wait = { type: "frames", resume: f + n + 1 };
        return false;
      }
      case 0x2d:
        if (cmd.macro.toLowerCase() === "settimeofday") this.marker("timeOfDay", src, String(arg(0) ?? cmd.args[0]?.text ?? ""));
        return true;
      case 0x4f:
      case 0x50:
        this.applyMovement(cmd, src);
        return true;
      case 0x51:
      case 0x52: {
        const raw = arg(0);
        const id = raw === 0 ? this.lastMoved : this.actorId(raw);
        this.wait = { type: "movement", actor: id ?? -1, since: f };
        return false;
      }
      case 0x53:
      case 0x54: {
        const a = this.actorOf(arg(0));
        if (a) {
          this.set(a, { present: false, visible: false });
          if (a.init.flag) this.flags.set(a.init.flag, true);
          a.movement = null;
        }
        return true;
      }
      case 0x55:
      case 0x56: {
        const a = this.actorOf(arg(0), true);
        if (a && !a.base.present) {
          const i = a.init;
          this.set(a, { present: true, visible: true, tileX: i.x, tileY: i.y, pixelX: i.x * 16, pixelY: i.y * 16, facing: i.defaultFacing, height: 0 });
        }
        return true;
      }
      case 0x57: {
        const a = this.actorOf(arg(0));
        const x = arg(1);
        const y = arg(2);
        if (a && x !== null && y !== null) {
          a.current = null;
          this.set(a, { tileX: x, tileY: y, pixelX: x * 16, pixelY: y * 16 });
        }
        return true;
      }
      case 0x58:
      case 0x59: {
        const a = this.actorOf(arg(0));
        if (a) this.set(a, { visible: cmd.opcode === 0x58 });
        return true;
      }
      case 0x5a: {
        const talker = this.options.start.talker;
        const a = talker === null ? undefined : this.actors.get(talker);
        const player = this.actors.get(PLAYER_ID);
        if (a && player) this.set(a, { facing: oppositeDirection(this.stateNow(player).facing) });
        return true;
      }
      case 0x5b: {
        const a = this.actorOf(arg(0));
        const d = directionFromCode(arg(1));
        if (a && d) this.set(a, { facing: d });
        return true;
      }
      case 0x6e:
        this.choice(src, this.lastText || cmd.written, "yesno", YES_NO, 1);
        return true;
      case 0x6f:
      case 0x70:
      case 0x71: {
        // multichoice2 は 4 つ目の引数が既定の項目。
        const initial = cmd.opcode === 0x70 ? (arg(3) ?? 0) : 0;
        this.choice(src, this.lastText || cmd.written, "multichoice", null, initial);
        return true;
      }
      case 0x74:
        // ND・Chronos の customchoice（CFRU で 0x74 を差し替え。上が 0、下が 1）。ほかの 0x74 は何もしない。
        if (cmd.macro.toLowerCase() === "customchoice") {
          const texts = cmd.args.map((a) => a.text ?? "");
          const [top, bottom] = texts.length >= 4 ? [texts[0]!, texts[2]!] : [texts[0] ?? "", texts[1] ?? ""];
          this.choice(src, this.lastText || cmd.written, "custom", [{ value: 0, name: top }, { value: 1, name: bottom }], 0);
        }
        return true;
      case 0x97:
      case 0x98:
        this.marker("fade", src, String(arg(0) ?? ""));
        return true;
      default:
        return true;
    }
  }

  private setVar(id: number | null, value: number | null): void {
    if (id === null) return;
    this.vars.set(id, value);
  }

  /** 人物の番号（0x4000 以上なら変数の中身）。分からなければ null。 */
  private actorId(raw: number | null): number | null {
    if (raw === null) return null;
    if (raw >= 0x4000) return this.varValue(raw);
    return raw;
  }

  private actorOf(raw: number | null, includeAbsent = false): SimActor | undefined {
    const id = this.actorId(raw);
    if (id === null) return undefined;
    const a = this.actors.get(id);
    if (!a) return undefined;
    if (!includeAbsent && !a.base.present && a.id !== CAMERA_ID) return a;
    return a;
  }

  /** 命令ですぐ状態を変える（そのフレームから）。 */
  private set(a: SimActor, patch: Partial<ActorBase>): void {
    if (!this.initials.has(a.id)) this.initials.set(a.id, a.base);
    if (a.current) {
      // 歩いている途中の向き・見えるかの変更は、その命令の始めの状態に足して計算し直す。
      const k = this.frame - a.current.start;
      const base = { ...a.current.base, ...patch };
      a.current = { ...a.current, base };
      a.changes.push({ type: "step", frame: this.frame, base, action: a.current.action, offset: k, ...a.current.ctx });
      a.base = { ...a.base, ...patch };
      return;
    }
    a.base = { ...a.base, ...patch };
    a.changes.push({ type: "set", frame: this.frame, base: a.base });
  }

  /** 今のフレームのスクリプトの時点（前のフレームまで動いた後）の状態。 */
  private stateNow(a: SimActor): ActorBase {
    if (!a.current) return a.base;
    const k = this.frame - 1 - a.current.start;
    if (k < 0) return a.current.base;
    return applyStepFrame(a.current.base, a.current.action, k, a.current.ctx).base;
  }

  private applyMovement(cmd: WalkCommand, src: PlaybackSource): void {
    const raw = cmd.args[0]?.value ?? null;
    const id = this.actorId(raw);
    const a = id === null ? undefined : this.actors.get(id);
    const label = cmd.args[1]?.text ?? "";
    if (!a) {
      this.marker("ignored", src, id === null ? `人物の番号が分かりません（${cmd.args[0]?.text ?? ""}）` : `人物 ${id} がいません`);
      return;
    }
    if (a.movement && a.movement.finished === null) {
      this.marker("ignored", src, `人物 ${a.id} はまだ動いています`);
      return;
    }
    const block = this.movementBlock(cmd);
    if (!block) {
      this.marker("ignored", src, `移動データが読めません（${label}）`);
      return;
    }
    const values = block.steps.map((s) => s.value);
    if (!block.endStep) this.marker("warning", src, `移動データ ${label} に end_m がありません`);
    const loc = this.options.project.index.findLabel(label);
    a.movement = {
      values,
      steps: block.labelLine < 0 ? block.steps.map(() => null) : block.steps,
      index: 0,
      label,
      path: block.labelLine < 0 ? null : (loc?.path ?? null),
      command: src,
      finished: null,
    };
    this.lastMoved = a.id;
  }

  private readonly blocks = new Map<string, MovementBlock | null>();

  private movementBlock(cmd: WalkCommand): MovementBlock | null {
    const arg = cmd.args[1];
    if (!arg) return null;
    if (this.blocks.has(arg.text)) return this.blocks.get(arg.text)!;
    let block: MovementBlock | null = null;
    const loc = this.options.project.index.findLabel(arg.text);
    if (loc) {
      const text = this.options.project.text(loc.path);
      if (text !== null) block = readMovementBlock(text, arg.text, (n) => this.walker.evaluate(n));
    } else if (arg.value !== null) {
      block = this.options.romMovement?.(arg.value >>> 0) ?? null;
    }
    this.blocks.set(arg.text, block);
    return block;
  }

  // ---- 2. 移動データを人物に渡す ----

  private movementPhase(): void {
    const f = this.frame;
    for (const a of this.actors.values()) {
      const m = a.movement;
      if (!m || m.finished !== null || a.current) continue;
      if (m.index >= m.values.length) {
        m.finished = f;
        continue;
      }
      const value = m.values[m.index]!;
      const action = movementAction(value);
      const stepIndex = m.index++;
      if (value === MOVEMENT_END) {
        m.finished = f;
        continue;
      }
      if (!this.initials.has(a.id)) this.initials.set(a.id, a.base);
      const player = this.actors.get(PLAYER_ID);
      const playerState = player ? this.stateNow(player) : null;
      const ctx = {
        playerFacing: playerState?.facing ?? "down",
        toPlayer: playerState && player !== a ? directionTo(a.base, playerState) : null,
        defaultFacing: a.init.defaultFacing,
        priorityViewY: this.focus().y - PLAYER_SCREEN_ORIGIN.y,
        ...(this.options.elevationAt ? { elevationAt: this.options.elevationAt } : {}),
      };
      a.current = { action, start: f, base: a.base, ctx };
      a.changes.push({ type: "step", frame: f, base: a.base, action, offset: 0, ...ctx });
      if (action.effect?.type === "mark") a.marks.push({ frame: f, mark: action.effect.mark, frames: action.effect.frames });
      if (action.kind === "unknown" || !action.framesKnown) {
        this.marker(action.kind === "unknown" ? "warning" : "warning", m.command, `${action.kind === "unknown" ? "知らない移動コマンド" : "長さの分からない移動コマンド"} 0x${value.toString(16).toUpperCase()}`);
      }
      const end = applyStepFrame(a.base, action, action.frames - 1, ctx).base;
      this.segments.push({
        actor: a.id,
        start: f,
        end: f + action.frames - 1,
        movementId: value,
        fromX: a.base.tileX,
        fromY: a.base.tileY,
        toX: end.tileX,
        toY: end.tileY,
        command: m.command,
        movementLabel: m.label,
        stepIndex,
        step: m.steps[stepIndex] ?? null,
        movementPath: m.path,
      });
    }
  }

  // ---- 3. 人物を動かす ----

  private actorPhase(): void {
    const f = this.frame;
    for (const a of this.actors.values()) {
      const c = a.current;
      if (!c) continue;
      const k = f - c.start;
      if (k >= c.action.frames - 1) {
        a.base = applyStepFrame(c.base, c.action, c.action.frames - 1, c.ctx).base;
        a.current = null;
      }
    }
  }

  // ---- special と callasm ----

  private context(src: PlaybackSource): PlaybackHandlerContext {
    return {
      frame: this.frame,
      getVar: (id) => this.varValue(id),
      setVar: (id, v) => this.vars.set(id, v),
      cameraStart: () => this.cameraStart(src),
      cameraEnd: () => this.cameraEnd(src),
      shake: (dx, dy, interval, frames) => {
        this.shakes.push({ start: this.frame, end: this.frame + frames, dx, dy, interval });
        this.stateEnd = Math.max(this.stateEnd, this.frame + frames);
        this.marker("shake", src, `${frames} フレーム（縦 ${dy}・横 ${dx}、${interval} フレームごと）`);
      },
      waitState: (frames) => {
        this.stateEnd = Math.max(this.stateEnd, this.frame + frames);
      },
      setVisible: (actor, visible) => {
        const a = this.actors.get(actor);
        if (a) this.set(a, { visible });
      },
      marker: (kind, detail) => this.marker(kind, src, detail),
    };
  }

  /** 画面が今追っている点（画素）。 */
  private focus(): { x: number; y: number } {
    const t = this.actors.get(this.camera.target) ?? this.actors.get(PLAYER_ID);
    const s = t ? this.stateNow(t) : null;
    return { x: (s?.pixelX ?? 0) + this.camera.offsetX, y: (s?.pixelY ?? 0) + this.camera.offsetY };
  }

  private cameraStart(src: PlaybackSource): void {
    const p = this.focus();
    const tileX = Math.round(p.x / 16);
    const tileY = Math.round(p.y / 16);
    let cam = this.actors.get(CAMERA_ID);
    if (!cam) {
      cam = this.addActor({ id: CAMERA_ID, graphicsId: -1, x: tileX, y: tileY, elevation: 0, facing: "down", defaultFacing: "down", present: false });
      this.initials.set(CAMERA_ID, cam.base);
    }
    this.set(cam, { present: true, visible: false, tileX, tileY, pixelX: tileX * 16, pixelY: tileY * 16, facing: "down" });
    cam.movement = null;
    cam.current = null;
    this.retarget(CAMERA_ID, p);
    this.marker("camera", src, "CAMERA_START");
  }

  private cameraEnd(src: PlaybackSource): void {
    const p = this.focus();
    this.retarget(PLAYER_ID, p);
    const cam = this.actors.get(CAMERA_ID);
    if (cam) {
      this.set(cam, { present: false });
      cam.movement = null;
      cam.current = null;
    }
    this.marker("camera", src, "CAMERA_END");
  }

  /** 追う相手を替える。画面が動かないように、ずれを足し直す。 */
  private retarget(target: number, focus: { x: number; y: number }): void {
    const t = this.actors.get(target);
    const s = t ? this.stateNow(t) : null;
    this.camera = { target, offsetX: focus.x - (s?.pixelX ?? 0), offsetY: focus.y - (s?.pixelY ?? 0) };
    this.cameraChanges.push({ frame: this.frame, ...this.camera });
  }

  private marker(kind: PlaybackMarkerKind, source: PlaybackSource | null, detail: string): void {
    this.markers.push({ frame: this.frame, kind, source, detail, branch: null });
  }

  private readonly choiceVisits = new Map<string, number>();

  /** 選択肢。答えの表か既定の値を LASTRESULT に入れる。 */
  private choice(source: PlaybackSource, detail: string, kind: PlaybackChoiceMark["kind"], options: readonly PlaybackChoiceOption[] | null, initial: number): void {
    const place = `choice:${source.path}:${source.line}:${source.part}`;
    const visit = this.choiceVisits.get(place) ?? 0;
    this.choiceVisits.set(place, visit + 1);
    const key = `${place}#${visit}`;
    const given = this.options.choices?.get(key);
    const value = given ?? initial;
    this.vars.set(VAR_LASTRESULT, value);
    this.markers.push({ frame: this.frame, kind: "choice", source, detail, branch: null, choice: { key, kind, options, value, defaulted: given === undefined } });
  }
}

/** a から b の方への向き（横を先に見る）。同じマスなら null。 */
function directionTo(a: ActorBase, b: ActorBase): MovementDirection | null {
  if (b.tileX < a.tileX) return "left";
  if (b.tileX > a.tileX) return "right";
  if (b.tileY < a.tileY) return "up";
  if (b.tileY > a.tileY) return "down";
  return null;
}
