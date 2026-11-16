import { MOVEMENT_DELTA, oppositeDirection, type MovementAction, type MovementDirection } from "../movement/MovementActionTable.js";
import { actorSubpriority } from "../../render/ActorPriority.js";
import type {
  PlaybackActorState,
  PlaybackCamera,
  PlaybackCommandRecord,
  PlaybackMarker,
  PlaybackSegment,
  PlaybackState,
} from "./PlaybackState.js";

/**
 * 再生のタイムライン（#451）。先に最後まで計算した結果を持ち、任意のフレームの状態を `stateAt` で出す。
 * コマ送り・戻し・ジャンプは「そのフレームの状態を出す」だけになるので、戻すための記録は要らない。
 *
 * 人物ごとに「変化」の並び（移動コマンドの区間と、命令ですぐ変えた状態）を持ち、フレームの状態は二分探索で見つけた
 * 変化から計算する。移動コマンドの途中のフレームは {@link applyStepFrame} で出す（計算の側も同じ関数を使う）。
 */

/** 人物の、命令の間で持ち越す状態。 */
export interface ActorBase {
  readonly graphicsId: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly facing: MovementDirection;
  readonly visible: boolean;
  readonly present: boolean;
  readonly lockFacing: boolean;
  readonly animHold: boolean;
  readonly fixedPriority: boolean;
  readonly subpriority?: number | undefined;
  /** 命令の後も残る高さ（ワープで上へ消えた後など）。ふつうは 0。 */
  readonly height: number;
  readonly elevation: number;
}

export interface StepContext {
  readonly playerFacing: MovementDirection;
  readonly toPlayer: MovementDirection | null;
  readonly defaultFacing: MovementDirection;
  readonly elevationAt?: (x: number, y: number) => number | null;
  readonly priorityViewY?: number;
}

/** 人物の変化 1 つ。 */
export type ActorChange =
  /** 移動コマンド。start のフレームから frames フレーム。offset は途中から計算し直したときの、始まりのずれ。 */
  | ({ readonly type: "step"; readonly frame: number; readonly base: ActorBase; readonly action: MovementAction; readonly offset: number } & StepContext)
  /** 命令ですぐ変えた状態（そのフレームから）。 */
  | { readonly type: "set"; readonly frame: number; readonly base: ActorBase };

/** 1 人分の記録。 */
export interface ActorTrack {
  readonly id: number;
  readonly initial: ActorBase;
  readonly changes: readonly ActorChange[];
  /** 頭の上の印（出し始めのフレームと名前）。 */
  readonly marks: readonly { readonly frame: number; readonly mark: string; readonly frames: number }[];
}

/** 画面の追う相手の変化。 */
export interface CameraChange {
  readonly frame: number;
  readonly target: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** 画面の揺れ（`special 0x136`）。interval フレームごとに符号を反転する。 */
export interface ShakeSpan {
  readonly start: number;
  /** 終わりのフレーム（含まない）。 */
  readonly end: number;
  readonly dx: number;
  readonly dy: number;
  readonly interval: number;
}

/** 移動コマンドの途中の 1 フレームの結果。 */
export interface StepFrame {
  readonly base: ActorBase;
  /** そのフレームの高さ。 */
  readonly height: number;
  readonly facing: MovementDirection;
}

/**
 * 移動コマンドを始めたときの状態 base から、k フレーム目（0 始まり）を終えた状態。
 * - 画素は pixels の 0〜k の合計だけ向きの方へ進む。マスは tileSteps のフレームで 1 マス進む。
 * - 向き: 歩き・足踏み・ジャンプ・向き変えは命令の向き（向きの固定中は変えない）。半分で逆を向くジャンプは turnAt から逆。
 * - 効き目（見える・見えない、向きの固定など）は 0 フレーム目に効く。
 */
export function applyStepFrame(
  base: ActorBase,
  action: MovementAction,
  k: number,
  ctx: StepContext,
): StepFrame {
  let { tileX, tileY, pixelX, pixelY, facing, visible, lockFacing, animHold, fixedPriority, elevation, subpriority } = base;
  const dir = action.direction;
  const e = action.effect;
  if (e) {
    if (e.type === "lockFacing") lockFacing = e.on;
    else if (e.type === "animHold") animHold = e.on;
    else if (e.type === "visible") visible = e.on;
    else if (e.type === "fixedPriority") {
      if (e.on && !fixedPriority) subpriority = actorSubpriority(elevation, pixelY, ctx.priorityViewY ?? 0);
      if (!e.on) subpriority = undefined;
      fixedPriority = e.on;
    }
    else if (e.type === "facePlayer" && ctx.toPlayer) facing = ctx.toPlayer;
    else if (e.type === "faceAwayPlayer" && ctx.toPlayer) facing = oppositeDirection(ctx.toPlayer);
    else if (e.type === "faceDefault") facing = ctx.defaultFacing;
  }
  if (dir && !base.lockFacing && (action.kind === "walk" || action.kind === "walkInPlace" || action.kind === "jump" || action.kind === "face")) facing = dir;
  if (dir && action.turnAt !== null && k >= action.turnAt && !base.lockFacing) facing = oppositeDirection(dir);
  if (dir) {
    const d = MOVEMENT_DELTA[dir];
    for (const t of action.tileSteps) {
      if (t > k) break;
      tileX += d.x;
      tileY += d.y;
    }
    if (action.pixels) {
      let sum = 0;
      for (let i = 0; i <= k && i < action.pixels.length; i++) sum += action.pixels[i]!;
      pixelX += d.x * sum;
      pixelY += d.y * sum;
    }
  }
  const height = action.heights ? (action.heights[Math.min(k, action.heights.length - 1)] ?? 0) : base.height;
  if (!fixedPriority && ctx.elevationAt) {
    const from = ctx.elevationAt(base.tileX, base.tileY);
    const to = ctx.elevationAt(tileX, tileY);
    if (from !== 15 && to !== null && Number.isInteger(to) && to > 0 && to < 15) elevation = to;
  }
  const last = k >= action.frames - 1;
  const after: ActorBase = {
    ...base,
    tileX,
    tileY,
    pixelX,
    pixelY,
    facing,
    visible,
    lockFacing,
    animHold,
    fixedPriority,
    elevation,
    ...(subpriority === undefined && base.subpriority === undefined ? {} : { subpriority }),
    height: last ? (action.keepHeight ? height : action.heights ? 0 : base.height) : base.height,
  };
  return { base: after, height, facing };
}

/** 状態の計算に使う、変化 1 つの結果（そのフレームの状態の素）。 */
interface Resolved {
  readonly base: ActorBase;
  readonly height: number;
  readonly action: MovementAction | null;
  readonly actionFrame: number;
}

function resolveAt(track: ActorTrack, frame: number): Resolved {
  const changes = track.changes;
  // frame 以下で最後の変化。
  let lo = 0;
  let hi = changes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (changes[mid]!.frame <= frame) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return { base: track.initial, height: track.initial.height, action: null, actionFrame: 0 };
  const c = changes[found]!;
  if (c.type === "set") return { base: c.base, height: c.base.height, action: null, actionFrame: 0 };
  const k = frame - c.frame + c.offset;
  const r = applyStepFrame(c.base, c.action, Math.min(k, c.action.frames - 1), c);
  if (k >= c.action.frames - 1 && frame > c.frame + (c.action.frames - 1 - c.offset)) {
    // 命令が終わった後（次の変化まで）は止まった状態。
    return { base: r.base, height: r.base.height, action: null, actionFrame: 0 };
  }
  return { base: r.base, height: r.height, action: c.action, actionFrame: k };
}

function stateOf(track: ActorTrack, r: Resolved, frame: number): PlaybackActorState {
  const mark = [...track.marks].reverse().find(m => m.frame <= frame && frame < m.frame + m.frames) ?? null;
  return {
    id: track.id, graphicsId: r.base.graphicsId,
    tileX: r.base.tileX, tileY: r.base.tileY, pixelX: r.base.pixelX, pixelY: r.base.pixelY,
    height: r.height, facing: r.base.facing,
    sprite: r.action && r.action.kind === "face" ? "stand" : r.action?.sprite ?? "stand",
    actionFrame: r.actionFrame, movementId: r.action?.id ?? null,
    visible: r.base.visible, present: r.base.present, shadow: r.action?.kind === "jump",
    mark: mark ? { mark: mark.mark, frame: frame - mark.frame } : null,
    elevation: r.base.elevation, fixedPriority: r.base.fixedPriority,
    ...(r.base.fixedPriority && r.base.subpriority !== undefined ? { subpriority: r.base.subpriority } : {}),
    animHold: r.base.animHold,
  };
}

/** 計算した結果。 */
export class Timeline {
  private readonly byId: ReadonlyMap<number, ActorTrack>;
  constructor(
    /** 人物ごとの記録（番号の小さい順）。 */
    readonly tracks: readonly ActorTrack[],
    /** 人物ごとの移動コマンドの区間（始まりの順）。 */
    readonly segments: readonly PlaybackSegment[],
    /** 全体の印（フレームの順）。 */
    readonly markers: readonly PlaybackMarker[],
    /** 実行した命令（実行の順）。 */
    readonly commands: readonly PlaybackCommandRecord[],
    readonly cameraChanges: readonly CameraChange[],
    readonly shakes: readonly ShakeSpan[],
    /** 最後のフレーム（含む）。 */
    readonly lastFrame: number,
  ) { this.byId = new Map(tracks.map(track => [track.id, track])); }

  /** 1人だけの状態。アニメーションの計算で、他の人物やカメラを毎回作らない。 */
  actorAt(id: number, frame: number): PlaybackActorState | null {
    const track = this.byId.get(id);
    if (!track) return null;
    const f = Math.max(0, Math.min(Math.floor(frame), this.lastFrame));
    return stateOf(track, resolveAt(track, f), f);
  }

  /** フレームの状態。範囲の外は端に寄せる。 */
  stateAt(frame: number): PlaybackState {
    const f = Math.max(0, Math.min(Math.floor(frame), this.lastFrame));
    const actors: PlaybackActorState[] = [];
    const resolved = new Map<number, Resolved>();
    for (const t of this.tracks) {
      const r = resolveAt(t, f);
      resolved.set(t.id, r);
      actors.push(stateOf(t, r, f));
    }
    return { frame: f, actors, camera: this.cameraAt(f, resolved) };
  }

  private cameraAt(f: number, resolved: ReadonlyMap<number, Resolved>): PlaybackCamera {
    let change: CameraChange = { frame: -1, target: 0xff, offsetX: 0, offsetY: 0 };
    for (const c of this.cameraChanges) if (c.frame <= f) change = c;
    const t = resolved.get(change.target) ?? resolved.get(0xff);
    let shakeX = 0;
    let shakeY = 0;
    for (const s of this.shakes) {
      if (f < s.start || f >= s.end) continue;
      const sign = Math.floor((f - s.start) / Math.max(1, s.interval)) % 2 === 0 ? 1 : -1;
      shakeX = s.dx * sign;
      shakeY = s.dy * sign;
    }
    return {
      target: change.target,
      x: (t?.base.pixelX ?? 0) + change.offsetX,
      y: (t?.base.pixelY ?? 0) + change.offsetY,
      shakeX,
      shakeY,
    };
  }

  /**
   * コマ送りの点（A-4）。全員の移動コマンドの「始まり・半分・終わり」と、印のフレームを時間順に合わせ、
   * 1 フレームしか違わない点は前の点にまとめる。1 フレームの命令は 1 点。最初（0）と最後のフレームも入れる。
   */
  keyFrames(): number[] {
    const points = new Set<number>([0, this.lastFrame]);
    for (const s of this.segments) {
      points.add(s.start);
      points.add(s.start + Math.floor((s.end - s.start + 1) / 2));
      points.add(s.end);
    }
    for (const m of this.markers) points.add(m.frame);
    const sorted = [...points].filter((p) => p >= 0 && p <= this.lastFrame).sort((a, b) => a - b);
    const out: number[] = [];
    for (const p of sorted) if (out.length === 0 || p - out[out.length - 1]! > 1) out.push(p);
    if (out[out.length - 1] !== this.lastFrame && this.lastFrame - out[out.length - 1]! <= 1) out[out.length - 1] = this.lastFrame;
    return out;
  }

  /** 人物の区間（始まりの順）。 */
  segmentsOf(actor: number): PlaybackSegment[] {
    return this.segments.filter((s) => s.actor === actor);
  }

  /** フレームで動いている区間（人物ごとに 1 つまで）。 */
  activeSegments(frame: number): PlaybackSegment[] {
    return this.segments.filter((s) => s.start <= frame && frame <= s.end);
  }
}
