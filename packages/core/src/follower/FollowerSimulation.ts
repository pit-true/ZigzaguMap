import { MOVEMENT_DELTA, movementAction, oppositeDirection, type MovementAction, type MovementDirection } from "../script/movement/MovementActionTable.js";
import { FOLLOWER_ID, type PlaybackActorState } from "../script/playback/PlaybackState.js";
import { actorSubpriority } from "../render/ActorPriority.js";
import type { SceneActor } from "../render/GameScene.js";
import type { RgbaImage } from "../render/color.js";
import { createImage } from "../render/color.js";

/**
 * 仮の主人公に付いてくる連れ歩き（#477）。ND の `follower_mon.c`・`follow_me.c` の規則のうち、仮の配置で要るものだけを写す。
 *
 * - 主人公が直前までいたマスに入る。主人公が 1 マス動くたびに 1 歩（16 フレームの歩き）。
 * - まだ歩いている間に主人公が動いたら、その歩数を覚えておき、主人公の通った道を速い歩き（4 フレーム）で追う
 *   （`PATH_CAP` 5 歩まで。あふれた分は、絵を動かさずにマスだけ進める）。
 * - 主人公をドラッグして何マスも離したときは、通った道を x、y の順の折れ線とみなして追う。12 マスより遠いときは、主人公の
 *   すぐ後ろへ置き直す（ワープの扱い）。
 * - 段差: 道の途中の段差のマス（その向きへ跳べる段差）を越える 2 歩は、2 マスのジャンプ（`JUMP_x_2`）にする。
 * - 位置は保存しない。止まっている間はコマを進めない（ゲームの待機の上下の揺れは描かない）。
 */

/** 段差か（`(x, y)` のマスが、`direction` の向きに跳び越える段差か）。 */
export type FollowerLedge = (x: number, y: number, direction: MovementDirection) => boolean;

/** 連れ歩きの絵の番号（`FOLLOWER_MON_GFX_ID`。ROM の人物の表には無い番号で、絵は DPE のシートから描く）。 */
export const FOLLOWER_GRAPHICS_ID = 0xfefe;
/** 覚えておく歩数（`PATH_CAP`）。 */
export const FOLLOWER_PATH_CAP = 5;
/** これより遠くへ主人公を動かしたら置き直す。 */
export const FOLLOWER_WARP_DISTANCE = 12;
const WALK = 0x10, WALK_FASTEST = 0x35, JUMP_2 = 0x14;
const INDEX: Readonly<Record<MovementDirection, number>> = { down: 0, up: 1, left: 2, right: 3 };

interface Step { readonly direction: MovementDirection; readonly jump: boolean }

export class FollowerSimulation {
  private x: number;
  private y: number;
  private facingValue: MovementDirection;
  private queue: Step[] = [];
  private running: { action: MovementAction; direction: MovementDirection; calls: number; moved: number } | null = null;
  /** 歩きのアニメの時間（歩き続けている間だけ進む）。 */
  private animTime = 0;
  private walking = false;

  constructor(start: { readonly x: number; readonly y: number; readonly facing: MovementDirection }) {
    this.x = start.x;
    this.y = start.y;
    this.facingValue = start.facing;
  }

  /** 主人公の後ろ（向きの反対のマス）に置く。 */
  static behind(player: { readonly x: number; readonly y: number; readonly facing: MovementDirection }, inside: (x: number, y: number) => boolean): FollowerSimulation {
    const back = MOVEMENT_DELTA[oppositeDirection(player.facing)];
    const x = player.x + back.x, y = player.y + back.y;
    return new FollowerSimulation(inside(x, y) ? { x, y, facing: player.facing } : { x: player.x, y: player.y, facing: player.facing });
  }

  get tileX(): number { return this.x; }
  get tileY(): number { return this.y; }
  get facing(): MovementDirection { return this.facingValue; }
  /** 歩いているか、追う歩数が残っているか（時計を回す間）。 */
  get busy(): boolean { return this.running !== null || this.queue.length > 0; }

  /** 主人公が `from` から `to` へ動いた。 */
  playerMoved(from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }, ledge: FollowerLedge): void {
    const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (distance === 0) return;
    // 追う道: 自分 → 主人公が居たマス → 主人公の通ったマス（最後のマスは主人公が居るので入らない）。
    const tail = this.pendingEnd({ x: this.x, y: this.y });
    const cells = [...pathCells(tail, from), ...pathCells(from, to).slice(0, -1)];
    if (distance > FOLLOWER_WARP_DISTANCE || cells.length > FOLLOWER_WARP_DISTANCE + 2) {
      const last = cells.at(-1) ?? from;
      this.queue = []; this.running = null; this.walking = false; this.animTime = 0;
      this.x = last.x; this.y = last.y;
      this.facingValue = directionBetween(last, to) ?? this.facingValue;
      return;
    }
    let at = tail;
    for (let i = 0; i < cells.length; i++) {
      const next = cells[i]!;
      const direction = directionBetween(at, next)!;
      const after = cells[i + 1];
      if (after && ledge(next.x, next.y, direction) && directionBetween(next, after) === direction) {
        this.push({ direction, jump: true });
        at = after; i++;
        continue;
      }
      this.push({ direction, jump: false });
      at = next;
    }
  }

  /** 1 フレーム進める。位置か絵が変わったら true。 */
  step(): boolean {
    if (!this.running) {
      const next = this.queue.shift();
      if (!next) {
        if (!this.walking) return false;
        this.walking = false; this.animTime = 0;
        return true;
      }
      // 1 歩だけなら普通の歩き、追いかけている間は速い歩き（`GetWalkFastestMovementAction`）。
      const id = next.jump ? JUMP_2 : this.queue.length > 0 ? WALK_FASTEST : WALK;
      this.running = { action: movementAction(id + INDEX[next.direction]), direction: next.direction, calls: 0, moved: 0 };
      this.facingValue = next.direction;
    }
    const r = this.running;
    const a = r.action;
    if (a.tileSteps.includes(r.calls)) {
      const d = MOVEMENT_DELTA[r.direction];
      this.x += d.x; this.y += d.y;
    }
    r.moved += a.pixels?.[r.calls] ?? 0;
    r.calls++;
    this.walking = true;
    this.animTime += a.kind === "jump" ? 0 : a.speed && a.speed > 1 ? 2 : 1;
    if (r.calls >= a.frames) this.running = null;
    return true;
  }

  /** 描く状態（番号は連れ歩きの 0xFE）。 */
  actor(elevation: number): PlaybackActorState & { readonly animIndex: number } {
    const r = this.running;
    const d = r ? MOVEMENT_DELTA[r.direction] : { x: 0, y: 0 };
    const startX = r ? this.x - d.x * (r.action.tileSteps.filter(s => s < r.calls).length) : this.x;
    const startY = r ? this.y - d.y * (r.action.tileSteps.filter(s => s < r.calls).length) : this.y;
    const pixelX = r ? startX * 16 + d.x * r.moved : this.x * 16;
    const pixelY = r ? startY * 16 + d.y * r.moved : this.y * 16;
    const height = r?.action.heights?.[r.calls - 1] ?? 0;
    return {
      id: FOLLOWER_ID, graphicsId: FOLLOWER_GRAPHICS_ID, tileX: this.x, tileY: this.y, pixelX, pixelY, height, facing: this.facingValue,
      sprite: r ? r.action.sprite ?? "walk" : "stand", actionFrame: r ? r.calls - 1 : 0, movementId: r ? r.action.id : null,
      visible: true, present: true, shadow: false, mark: null, elevation, fixedPriority: false, animHold: false,
      animIndex: this.animTime,
    };
  }

  /**
   * 歩数を覚える。あふれたら、いちばん古い歩数を歩いたことにしてマスだけ進める（ゲームは古い歩数を捨てるが、仮の配置では
   * 主人公の後ろに着くことを優先する）。
   */
  private push(step: Step): void {
    if (this.queue.length >= FOLLOWER_PATH_CAP) {
      const r = this.running;
      if (r) {
        const d = MOVEMENT_DELTA[r.direction];
        const left = r.action.tileSteps.filter(s => s >= r.calls).length;
        this.x += d.x * left; this.y += d.y * left; this.running = null;
      }
      const old = this.queue.shift()!;
      const d = MOVEMENT_DELTA[old.direction], n = old.jump ? 2 : 1;
      this.x += d.x * n; this.y += d.y * n; this.facingValue = old.direction;
    }
    this.queue.push(step);
  }

  /** 覚えている歩数を全部歩いた後のマス。 */
  private pendingEnd(from: { x: number; y: number }): { x: number; y: number } {
    let x = from.x, y = from.y;
    const r = this.running;
    if (r) {
      const d = MOVEMENT_DELTA[r.direction];
      const left = r.action.tileSteps.filter(s => s >= r.calls).length;
      x += d.x * left; y += d.y * left;
    }
    for (const s of this.queue) { const d = MOVEMENT_DELTA[s.direction]; const n = s.jump ? 2 : 1; x += d.x * n; y += d.y * n; }
    return { x, y };
  }
}

/** `from` の次から `to` までのマス（x を先に、次に y。`to` を含む）。 */
function pathCells(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = from.x, y = from.y;
  while (x !== to.x) { x += Math.sign(to.x - x); out.push({ x, y }); }
  while (y !== to.y) { y += Math.sign(to.y - y); out.push({ x, y }); }
  return out;
}

function directionBetween(a: { x: number; y: number }, b: { x: number; y: number }): MovementDirection | null {
  if (b.x > a.x) return "right";
  if (b.x < a.x) return "left";
  if (b.y > a.y) return "down";
  if (b.y < a.y) return "up";
  return null;
}

/**
 * 連れ歩きのコマ（`sAnimTable` の Face と Go）。止まっていれば立ち（0・2・4）。歩きは 8 フレームごとに
 * 歩き → 立ち → 歩き（南と北は左右反転）→ 立ち。東は西の左右反転。
 */
export function followerFrame(facing: MovementDirection, walking: boolean, animIndex: number): { readonly index: number; readonly hFlip: boolean } {
  const base = facing === "down" ? 0 : facing === "up" ? 2 : 4;
  const east = facing === "right";
  if (!walking) return { index: base, hFlip: east };
  const step = Math.floor(animIndex / 8) % 4;
  const index = step % 2 === 0 ? base + 1 : base;
  const flip = base < 4 ? step === 2 : false;
  return { index, hFlip: east ? !flip : flip };
}

/** 64×64 のシートの 8 枚の並び（`P64`: 4 列 × 2 段、各 16×32）。 */
function piece(image: RgbaImage, c: number, r: number): RgbaImage {
  const out = createImage(16, 32);
  for (let y = 0; y < 32; y++) out.data.set(image.data.subarray(((r * 32 + y) * 64 + c * 16) * 4, ((r * 32 + y) * 64 + c * 16 + 16) * 4), y * 64);
  return out;
}

/**
 * 連れ歩きを `renderGameScene` の人物にする。32×32 は 1 枚で、重なり順は高さで決まる（ほかの人物と同じ）。64×64 は
 * `Task_FollowerMonSprite` と同じく 8 枚に分け、外の列は BG の優先度 1、真ん中の列と下の段は主人公の位置と前のマスの重ね方で
 * 1 か 2 にする。横を向いている間は、はみ出す分（`sideOffset`）だけ主人公と反対側へずらす。
 */
export function followerSceneActors(input: {
  readonly state: PlaybackActorState;
  readonly image: RgbaImage;
  readonly sideOffset: number;
  readonly player: { readonly x: number; readonly y: number };
  /** マスの重ね方が「両方の層が人物の下」（COVERED）か。 */
  readonly covered: (x: number, y: number) => boolean;
  readonly viewY: number;
}): SceneActor[] {
  const { state, image, player } = input;
  let shift = 0;
  if (state.facing === "left" || state.facing === "right") {
    if (player.x < state.tileX) shift = input.sideOffset;
    else if (player.x > state.tileX) shift = -input.sideOffset;
    else shift = state.facing === "left" ? input.sideOffset : -input.sideOffset;
  }
  const moved = { ...state, pixelX: state.pixelX + shift };
  const subpriority = actorSubpriority(state.elevation, state.pixelY, input.viewY);
  if (image.width !== 64) return [{ state: moved, image, subpriority }];
  let mask = 0;
  for (let c = 0; c < 4; c++) if (!input.covered(state.tileX + c - 2, state.tileY + 1)) mask |= 1 << c;
  if (player.y > state.tileY) mask |= 2 | 4;
  if (player.y < state.tileY) mask |= 16;
  const left = moved.pixelX + 8 - 32, top = moved.pixelY + 16 - 64 + moved.height;
  const out: SceneActor[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const outer = c === 0 || c === 3;
      const priority = r === 0 ? (outer ? 1 : mask & 16 ? 2 : 1) : mask & (1 << c) ? 2 : 1;
      out.push({ state: { ...moved, pixelX: left + 16 * c, pixelY: top + 32 * r + 16, height: 0 }, image: piece(image, c, r), priority, subpriority });
    }
  }
  return out;
}
