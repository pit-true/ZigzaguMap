import type { MapEvents, PersonEvent, SignEvent } from "../../event/types.js";
import { MOVEMENT_DELTA, MOVEMENT_DIRECTIONS, oppositeDirection, type MovementDirection } from "../movement/MovementActionTable.js";
import { VAR_FACING, VAR_LASTTALKED } from "./handlers/PlaybackHandlers.js";
import { directionCode, type PlaybackActorInit, type PlaybackStart } from "./PlaybackSimulator.js";
import { PLAYER_ID } from "./PlaybackState.js";

/**
 * 再生の始めの状態（#453）。主人公の位置と向き、男女、マップに居る人物を決める。主人公はマップに置かれていなくても、
 * 人物 0xFF として出す。
 *
 * - 人物に話しかける: 人物の下のマスで上を向く（下が壁でも下から。SPEC どおり）。仮の主人公が置いてあれば、その位置から人物の方を向く
 *   （隣でなくてもその位置のまま）。
 * - 看板: 下から上を向く。看板の向きの条件（`SignEvent.kind`）で上向きが駄目なら、条件に合う側から。
 * - 踏むスクリプト: そのマスの上で下を向く。変数の条件は見ずに始め、条件を返す（A-7）。
 * - マップスクリプト: 仮の主人公の位置。無ければ最初のワープの上。どちらも無ければ (0, 0)。
 * - 1 コマ目の向きは入力（`facing`）で変えられる。
 * - マップの人物は全員居るものとし、`absent` の番号だけ外す（A-6）。人物の自分の動き（移動タイプ）は止め、向きは移動タイプの
 *   基本の向き（`EvObjDefaultSiteTbl`）にする（A-5）。
 */

/** 主人公の絵の番号（ND `include/constants/event_objects.h`）。 */
export const PLAYER_GRAPHICS = { male: 0, female: 7 } as const;

/** 男女。 */
export type PlayerGender = keyof typeof PLAYER_GRAPHICS;

/** 再生の始まり方。 */
export type PlaybackTrigger =
  /** 人物に話しかける（localId）。 */
  | { readonly kind: "person"; readonly localId: number }
  /** 看板（マップのデータの何番目か）。 */
  | { readonly kind: "sign"; readonly index: number }
  /** 踏むスクリプト（マップのデータの何番目か）。 */
  | { readonly kind: "trap"; readonly index: number }
  /** マップスクリプト、またはラベルを直に選んだとき。 */
  | { readonly kind: "map" };

/** 仮の主人公（#457。B の組の部品）の位置と向き。 */
export interface ProvisionalPlayer {
  readonly x: number;
  readonly y: number;
  readonly facing: MovementDirection;
}

/** 始めの状態を決める材料。 */
export interface StartStateInput {
  readonly events: MapEvents;
  readonly trigger: PlaybackTrigger;
  readonly gender: PlayerGender;
  /** 仮の主人公。置いていなければ null か省略。 */
  readonly provisionalPlayer?: ProvisionalPlayer | null;
  /** 1 コマ目の主人公の向き（帯や矢印キーで変えたとき）。省けば始まり方で決まる向き。 */
  readonly facing?: MovementDirection | null;
  /** 居ないことにする人物（localId）。 */
  readonly absent?: readonly number[];
  /** 連れ歩き（ND の 0xFE）を出すときの絵の番号。出さなければ省略。 */
  readonly follower?: { readonly graphicsId: number } | null;
}

/** 決めた始めの状態。 */
export interface StartState extends PlaybackStart {
  /** 主人公の位置と向き。 */
  readonly player: ProvisionalPlayer;
  /** 踏むスクリプトの変数の条件（A-7。帯に出す）。踏むスクリプトでなければ null。 */
  readonly trapCondition: { readonly variable: number; readonly value: number } | null;
  /** 看板の向きの条件で、下からは調べられない看板だったか（別の側から始めた）。 */
  readonly signSide: MovementDirection | null;
}

/** 移動タイプの基本の向き（`evobjdat.c` の `EvObjDefaultSiteTbl`。D 下、U 上、L 左、R 右。0x00〜0x50）。 */
const DEFAULT_FACING = "DDDUDLRUDLRDDDLUUDDDDUDDDUDLRURDLULDRLURDRULDUDLRUDLRUDLRDDUDLRDDULRDULRDULRDDDDD";

/** 移動タイプの基本の向き。表の外は下。 */
export function defaultFacingOf(movementType: number): MovementDirection {
  const c = DEFAULT_FACING[movementType];
  return c === "U" ? "up" : c === "L" ? "left" : c === "R" ? "right" : "down";
}

/**
 * 看板の向きの条件（`SignEvent.kind`）で、主人公がその向きのときに調べられるか。
 * 0 全部、1 上向きだけ、2 下向きだけ、3 右向きだけ、4 左向きだけ（research_A の 4.4）。
 */
export function signAllows(kind: number, facing: MovementDirection): boolean {
  switch (kind) {
    case 1:
      return facing === "up";
    case 2:
      return facing === "down";
    case 3:
      return facing === "right";
    case 4:
      return facing === "left";
    default:
      return true;
  }
}

/** 看板を調べる主人公の向き（上を優先し、駄目なら条件に合う向き）。 */
function signFacing(sign: SignEvent): MovementDirection {
  if (signAllows(sign.kind, "up")) return "up";
  return MOVEMENT_DIRECTIONS.find((d) => signAllows(sign.kind, d)) ?? "up";
}

/** 人物の向き（from から to の方。横を先に見る）。同じマスなら fallback。 */
function facingToward(from: { x: number; y: number }, to: { x: number; y: number }, fallback: MovementDirection): MovementDirection {
  if (to.x < from.x) return "left";
  if (to.x > from.x) return "right";
  if (to.y < from.y) return "up";
  if (to.y > from.y) return "down";
  return fallback;
}

/** 始めの状態を決める。 */
export function buildPlaybackStart(input: StartStateInput): StartState {
  const { events, trigger } = input;
  const absent = new Set(input.absent ?? []);
  const provisional = input.provisionalPlayer ?? null;
  let player: ProvisionalPlayer;
  let talker: number | null = null;
  let trapCondition: StartState["trapCondition"] = null;
  let signSide: MovementDirection | null = null;

  if (trigger.kind === "person") {
    const p = events.persons.find((e) => e.localId === trigger.localId);
    talker = trigger.localId;
    if (provisional) {
      player = { x: provisional.x, y: provisional.y, facing: p ? facingToward(provisional, p, provisional.facing) : provisional.facing };
    } else {
      player = { x: p?.x ?? 0, y: (p?.y ?? 0) + 1, facing: "up" };
    }
  } else if (trigger.kind === "sign") {
    const s = events.signs[trigger.index];
    const facing = s ? signFacing(s) : "up";
    if (facing !== "up") signSide = facing;
    const d = MOVEMENT_DELTA[facing];
    player = { x: (s?.x ?? 0) - d.x, y: (s?.y ?? 0) - d.y, facing };
  } else if (trigger.kind === "trap") {
    const t = events.traps[trigger.index];
    player = { x: t?.x ?? 0, y: t?.y ?? 0, facing: "down" };
    if (t) trapCondition = { variable: t.variable, value: t.value };
  } else {
    const w = events.warps[0];
    player = provisional ? { ...provisional } : { x: w?.x ?? 0, y: w?.y ?? 0, facing: "down" };
  }
  if (input.facing) player = { ...player, facing: input.facing };

  const actors: PlaybackActorInit[] = [];
  actors.push({ id: PLAYER_ID, graphicsId: PLAYER_GRAPHICS[input.gender], x: player.x, y: player.y, elevation: 3, facing: player.facing, defaultFacing: player.facing });
  for (const p of events.persons) {
    if (actors.some((a) => a.id === p.localId)) continue;
    actors.push(personActor(p, !absent.has(p.localId)));
  }
  if (input.follower) {
    const back = MOVEMENT_DELTA[oppositeDirection(player.facing)];
    actors.push({ id: 0xfe, graphicsId: input.follower.graphicsId, x: player.x + back.x, y: player.y + back.y, elevation: 3, facing: player.facing, defaultFacing: player.facing });
  }

  const vars = new Map<number, number>([[VAR_FACING, directionCode(player.facing)]]);
  if (talker !== null) vars.set(VAR_LASTTALKED, talker);
  return { actors, talker, vars, player, trapCondition, signSide };
}

function personActor(p: PersonEvent, present: boolean): PlaybackActorInit {
  const facing = defaultFacingOf(p.movementType);
  return { id: p.localId, graphicsId: p.graphicsId, x: p.x, y: p.y, elevation: p.elevation, facing, defaultFacing: facing, present, flag: p.flag };
}
