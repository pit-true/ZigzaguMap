import { BUNDLED_MOVEMENT_NAMES } from "../disasm/bundledCommands.js";

/**
 * 移動コマンド（`applymovement` の移動データの 1 バイト）の表（#448）。再生の計算（#451）と、B の組の NPC の動き（#13）が使う。
 *
 * 根拠は FRLG 日本語版のソース `evobjmv.c`（`AcmdActionTbl` と各命令の段の関数）と、ROM の表（1 マスの歩数の表 16・8・6・4・2、
 * ジャンプの高さの表）。CFRU の感情アイコン（0xAA〜0xB9）は ND・Chronos の `src/emotes.c`。
 *
 * - フレーム数は「命令を渡したフレームから、命令が終わるフレームまでに段の関数が呼ばれる回数」。歩き（`walk_*`）は 16。
 *   1 歩目の 1 画素は命令を渡したフレームに動く（段 0 の準備のあとすぐ段 1 を呼ぶ）。
 * - 向きは +0 下、+1 上、+2 左、+3 右。
 * - 数値はソースと ROM の表から計算したもので、エミュレータでは確かめていない（ソースの読みだけ）。とくに
 *   ワープの上下（0xA4・0xA5）の 22 フレーム、拡大しながらの歩き（0x6E・0x6F）は段の関数の読みからの値。
 * - 長さがアニメのデータで決まる命令（0x45・0x5B・0x68・0x69・0x98〜0x9A・0x9F）は `framesKnown: false`（仮に 1 フレーム）。
 * - 自転車のウィリー（0x70〜0x93）、Chronos の 0xBA〜0xBD、表の外の番号は「知らない命令」（`kind: "unknown"`）。
 */

/** 向き。 */
export type MovementDirection = "down" | "up" | "left" | "right";

/** 向きの並び（番号の +0〜+3 と同じ順）。 */
export const MOVEMENT_DIRECTIONS: readonly MovementDirection[] = ["down", "up", "left", "right"];

/** 1 マス進むときの x・y の向き。 */
export const MOVEMENT_DELTA: Readonly<Record<MovementDirection, { readonly x: number; readonly y: number }>> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** 逆の向き。 */
export function oppositeDirection(d: MovementDirection): MovementDirection {
  return d === "down" ? "up" : d === "up" ? "down" : d === "left" ? "right" : "left";
}

/** 命令の種類。 */
export type MovementKind =
  /** 向きを変える（立ち絵）。 */
  | "face"
  /** 歩く（マスを進む）。 */
  | "walk"
  /** その場で足踏み。 */
  | "walkInPlace"
  /** ジャンプ（その場のものも含む）。 */
  | "jump"
  /** 待つ。 */
  | "wait"
  /** 状態を切り替える（向きの固定、見える・見えない など）。 */
  | "toggle"
  /** 頭の上の印・感情アイコン。 */
  | "mark"
  /** 絵のアニメ（長さは絵のデータ次第）。 */
  | "anim"
  /** ワープで上へ消える・上から降りる。 */
  | "warp"
  /** 移動データの終わり（0xFE）。 */
  | "end"
  /** 知らない命令。 */
  | "unknown";

/**
 * 絵の種類。B の組の人物の絵の部品へ渡す名前。
 * - stand: 立ち絵 / walk: 歩き / walkFast: 速い歩き（歩きの絵を速く回す） / run: 走りの絵 / jump: ジャンプ（歩きの絵と影） /
 *   surf: 波乗り / spin: 回る
 */
export type MovementSprite = "stand" | "walk" | "walkFast" | "run" | "jump" | "surf" | "spin";

/** 命令の効き目（再生で持つ状態）。 */
export type MovementEffect =
  /** 絵の向きを固定する（進む向きは変わる）。 */
  | { readonly type: "lockFacing"; readonly on: boolean }
  /** 歩きの絵の切り替えを止める（`disable_anim` で on）。 */
  | { readonly type: "animHold"; readonly on: boolean }
  /** 見える（on）・見えない。 */
  | { readonly type: "visible"; readonly on: boolean }
  /** 重なり順の固定。 */
  | { readonly type: "fixedPriority"; readonly on: boolean }
  /** 着地の地面の効果（再生では描かない）。 */
  | { readonly type: "groundEffect"; readonly on: boolean }
  /** 拡大縮小（再生では描かない）。 */
  | { readonly type: "affine"; readonly on: boolean }
  /** 頭の上の印を出す。命令は待たない。 */
  | { readonly type: "mark"; readonly mark: string; readonly frames: number }
  /** 主人公の方を向く。 */
  | { readonly type: "facePlayer" }
  /** 主人公と逆を向く。 */
  | { readonly type: "faceAwayPlayer" }
  /** 移動タイプの基本の向きに戻す。 */
  | { readonly type: "faceDefault" };

/** 移動コマンド 1 つ。 */
export interface MovementAction {
  /** 番号（0x00〜0xFF）。 */
  readonly id: number;
  /** ゲームのソースの名前（`AC_` を外したもの。`WALK_D_1` など）。知らない命令は空。 */
  readonly sourceName: string;
  readonly kind: MovementKind;
  /** 向き。向きの無い命令は null。 */
  readonly direction: MovementDirection | null;
  /** かかるフレーム数（1 以上）。 */
  readonly frames: number;
  /** フレーム数がソースから決まるか。false はアニメ次第で、frames は仮の 1。 */
  readonly framesKnown: boolean;
  /** フレームごとに、向きの方へ進む画素（長さは frames）。動かない命令は null。 */
  readonly pixels: readonly number[] | null;
  /** フレームごとの高さ（画素。マイナスが上。長さは frames）。ジャンプとワープだけ。 */
  readonly heights: readonly number[] | null;
  /** 命令が終わった後も最後の高さを保つか（ワープで上へ消えた後）。 */
  readonly keepHeight: boolean;
  /** 論理の位置（マス）が 1 マス進むフレーム（0 始まり）。歩きは [0]、2 マスのジャンプは [0, 15]。 */
  readonly tileSteps: readonly number[];
  /** その場で跳んで半分で逆を向く命令の、向きを変えるフレーム（0 始まり）。無ければ null。 */
  readonly turnAt: number | null;
  /** 絵の種類。向き変え・待ち・切り替えなど絵を変えない命令は null。 */
  readonly sprite: MovementSprite | null;
  readonly effect: MovementEffect | null;
  /** ソースの名前の速さの倍率（`WALK_D_2` なら 2）。歩き・足踏み・走りだけ。 */
  readonly speed: number | null;
  /**
   * xse の名前と中身がずれている命令（`run_*` は 2 倍の歩き、`slide_*` は 3・4・8 倍の歩き、
   * `slide_*_foot_*` は走りの絵の 2 倍・1.5 倍）。タイムラインで実際の動きを出す。
   */
  readonly nameMismatch: boolean;
}

/** 移動データの終わりの番号（`end_m`）。 */
export const MOVEMENT_END = 0xfe;

/** 頭の上の印・感情アイコンを出しておくフレーム数（`ev_trai.c`、CFRU の `EMOTE_FRAMES`）。ソースの読みだけ。 */
export const MOVEMENT_MARK_FRAMES = 60;

/** ジャンプの高さの表「高」（`EvActJumpOffsTblType0`、V_12）。 */
export const JUMP_HEIGHTS_HIGH: readonly number[] = [-4, -6, -8, -10, -11, -12, -12, -12, -11, -10, -9, -8, -6, -4, 0, 0];
/** ジャンプの高さの表「中」（`EvActJumpOffsTblType2`、V_8）。 */
export const JUMP_HEIGHTS_MID: readonly number[] = [-2, -4, -6, -8, -9, -10, -10, -10, -9, -8, -6, -5, -3, -2, 0, 0];
/** ジャンプの高さの表「低」（`EvActJumpOffsTblType1`、V_6）。スクリプトの命令では使わない。 */
export const JUMP_HEIGHTS_LOW: readonly number[] = [0, -2, -3, -4, -5, -6, -6, -6, -5, -5, -4, -3, -2, 0, 0, 0];

/** 1 マス（16 画素）の歩きの、フレームごとの画素（`EvActMoveCellTbl`）。 */
const CELL_PATTERNS = {
  1: repeat(1, 16),
  2: repeat(2, 8),
  3: [2, 3, 3, 2, 3, 3],
  4: repeat(4, 4),
  8: repeat(8, 2),
} as const;

function repeat(v: number, n: number): number[] {
  return new Array<number>(n).fill(v);
}

/** 0.5 倍（`ev_act_move_walk_05`）: 偶数回目に 1 画素。31 フレーム。 */
const WALK_05 = Array.from({ length: 31 }, (_, k) => (k % 2 === 0 ? 1 : 0));
/** 0.8 倍（`ev_act_move_walk_08`）: 3 回のうち 2 回 1 画素。23 フレーム。 */
const WALK_08 = Array.from({ length: 23 }, (_, k) => (k % 3 === 2 ? 0 : 1));
/** 0.1 倍（`ev_act_move_walk_01`）: 10 回目ごとに 1 画素。160 フレーム。 */
const WALK_01 = Array.from({ length: 160 }, (_, k) => (k % 10 === 9 ? 1 : 0));
/** 走りの 1.5 倍（`ev_act_move_dash_15`）: 1 画素と 2 画素を交互。11 フレーム。 */
const DASH_15 = Array.from({ length: 11 }, (_, k) => (k % 2 === 0 ? 1 : 2));

const DIR_LETTER: Readonly<Record<MovementDirection, string>> = { down: "D", up: "U", left: "L", right: "R" };

interface Spec {
  sourceName: string;
  kind: MovementKind;
  direction?: MovementDirection | null;
  frames?: number;
  framesKnown?: boolean;
  pixels?: readonly number[] | null;
  heights?: readonly number[] | null;
  keepHeight?: boolean;
  tileSteps?: readonly number[];
  turnAt?: number | null;
  sprite?: MovementSprite | null;
  effect?: MovementEffect | null;
  speed?: number | null;
  nameMismatch?: boolean;
}

function make(id: number, s: Spec): MovementAction {
  const frames = s.frames ?? s.pixels?.length ?? s.heights?.length ?? 1;
  return Object.freeze({
    id,
    sourceName: s.sourceName,
    kind: s.kind,
    direction: s.direction ?? null,
    frames,
    framesKnown: s.framesKnown ?? true,
    pixels: s.pixels ?? null,
    heights: s.heights ?? null,
    keepHeight: s.keepHeight ?? false,
    tileSteps: s.tileSteps ?? [],
    turnAt: s.turnAt ?? null,
    sprite: s.sprite ?? null,
    effect: s.effect ?? null,
    speed: s.speed ?? null,
    nameMismatch: s.nameMismatch ?? false,
  });
}

/** 向きの 4 つ組（base から +0〜+3）を足す。 */
function four(table: Map<number, MovementAction>, base: number, spec: (d: MovementDirection, letter: string) => Spec): void {
  MOVEMENT_DIRECTIONS.forEach((d, i) => table.set(base + i, make(base + i, { direction: d, ...spec(d, DIR_LETTER[d]) })));
}

function walk(name: string, pixels: readonly number[], sprite: MovementSprite, speed: number, nameMismatch = false): (d: MovementDirection, l: string) => Spec {
  return (_d, l) => ({ sourceName: name.replace("x", l), kind: "walk", pixels, tileSteps: [0], sprite, speed, nameMismatch });
}

function onSpot(name: string, frames: number, speed: number): (d: MovementDirection, l: string) => Spec {
  return (_d, l) => ({ sourceName: name.replace("x", l), kind: "walkInPlace", frames, sprite: "walk", speed });
}

/** ジャンプのフレームごとの高さ。every は表を進める間隔（1 か 2 フレーム）。最後のフレームは 0。 */
function jumpHeights(table: readonly number[], frames: number, every: 1 | 2): number[] {
  return Array.from({ length: frames }, (_, k) => (k === frames - 1 ? 0 : table[Math.floor(k / every)]!));
}

function build(): Map<number, MovementAction> {
  const t = new Map<number, MovementAction>();
  // 3.3 向き変え（1 フレーム）。
  four(t, 0x00, (_d, l) => ({ sourceName: `SITE_${l}`, kind: "face" }));
  four(t, 0x04, (_d, l) => ({ sourceName: `SWIM_SITE_${l}`, kind: "face", sprite: "surf" }));
  // 3.2 歩き。
  four(t, 0x08, walk("WALK_x_05", WALK_05, "walk", 0.5));
  four(t, 0x0c, walk("WALK_x_08", WALK_08, "walk", 0.8));
  four(t, 0x10, walk("WALK_x_1", CELL_PATTERNS[1], "walk", 1));
  // 3.4 2 マスのジャンプ: 始めと 16 回目（半分）に 1 マスずつ進む。高さは「高」を 2 フレームに 1 つ進める。
  four(t, 0x14, (_d, l) => ({
    sourceName: `JUMP_${l}_2`,
    kind: "jump",
    pixels: repeat(1, 32),
    heights: jumpHeights(JUMP_HEIGHTS_HIGH, 32, 2),
    tileSteps: [0, 15],
    sprite: "jump",
  }));
  // 待ち。
  const waits: [number, number][] = [
    [0x18, 1],
    [0x19, 2],
    [0x1a, 4],
    [0x1b, 8],
    [0x1c, 16],
  ];
  for (const [id, n] of waits) t.set(id, make(id, { sourceName: `WAIT_${n}`, kind: "wait", frames: n }));
  four(t, 0x1d, walk("WALK_x_2", CELL_PATTERNS[2], "walkFast", 2, true));
  // 3.3 その場の足踏み。
  four(t, 0x21, onSpot("STAY_WALK_x_05", 32, 0.5));
  four(t, 0x25, onSpot("STAY_WALK_x_1", 16, 1));
  four(t, 0x29, onSpot("STAY_WALK_x_2", 8, 2));
  four(t, 0x2d, onSpot("STAY_WALK_x_4", 4, 4));
  four(t, 0x31, walk("WALK_x_3", CELL_PATTERNS[3], "walkFast", 3, true));
  four(t, 0x35, walk("WALK_x_4", CELL_PATTERNS[4], "walkFast", 4, true));
  four(t, 0x39, walk("WALK_x_8", CELL_PATTERNS[8], "walkFast", 8, true));
  four(t, 0x3d, walk("DASH_x_2", CELL_PATTERNS[2], "run", 2, true));
  four(t, 0x41, walk("DASH_x_15", DASH_15, "run", 1.5, true));
  t.set(0x45, make(0x45, { sourceName: "ANM_END_WAIT", kind: "anim", framesKnown: false }));
  // 波乗りに乗るジャンプ: 1 マスを 0.5 画素／フレーム（偶数回目に 1 画素）、32 フレーム、高さは「高」を 2 フレームに 1 つ。
  const swimJump = (name: string) => (_d: MovementDirection, l: string): Spec => ({
    sourceName: name.replace("x", l),
    kind: "jump",
    pixels: Array.from({ length: 32 }, (_, k) => (k % 2 === 0 ? 1 : 0)),
    heights: jumpHeights(JUMP_HEIGHTS_HIGH, 32, 2),
    tileSteps: [0],
    sprite: "jump",
  });
  four(t, 0x46, swimJump("SWIM_JUMP_x"));
  t.set(0x4a, make(0x4a, { sourceName: "TURN_HERO_SITE", kind: "face", effect: { type: "facePlayer" } }));
  t.set(0x4b, make(0x4b, { sourceName: "TURN_REV_HERO_SITE", kind: "face", effect: { type: "faceAwayPlayer" } }));
  t.set(0x4c, make(0x4c, { sourceName: "SITE_PAUSE_ON", kind: "toggle", effect: { type: "lockFacing", on: true } }));
  t.set(0x4d, make(0x4d, { sourceName: "SITE_PAUSE_OFF", kind: "toggle", effect: { type: "lockFacing", on: false } }));
  // 1 マスのジャンプ（高さは「中」）、その場のジャンプ（「高」）、その場で跳んで半分で逆を向く（「中」）。
  four(t, 0x4e, (_d, l) => ({
    sourceName: `JUMP_${l}_1`,
    kind: "jump",
    pixels: repeat(1, 16),
    heights: jumpHeights(JUMP_HEIGHTS_MID, 16, 1),
    tileSteps: [0],
    sprite: "jump",
  }));
  four(t, 0x52, (_d, l) => ({ sourceName: `STAY_JUMP_${l}`, kind: "jump", heights: jumpHeights(JUMP_HEIGHTS_HIGH, 16, 1), sprite: "jump" }));
  four(t, 0x56, (_d, l) => ({
    sourceName: `STAY_TURN_JUMP_${l}`,
    kind: "jump",
    heights: jumpHeights(JUMP_HEIGHTS_MID, 16, 1),
    turnAt: 7,
    sprite: "jump",
  }));
  t.set(0x5a, make(0x5a, { sourceName: "DEFAULT_SITE", kind: "face", effect: { type: "faceDefault" } }));
  t.set(0x5b, make(0x5b, { sourceName: "PC_BOW", kind: "anim", framesKnown: false }));
  const toggles: [number, string, MovementEffect][] = [
    [0x5c, "UNDER_EFFECT_ON", { type: "groundEffect", on: true }],
    [0x5d, "UNDER_EFFECT_OFF", { type: "groundEffect", on: false }],
    [0x5e, "ANM_CHG_HOLD_ON", { type: "animHold", on: true }],
    [0x5f, "ANM_CHG_HOLD_OFF", { type: "animHold", on: false }],
    [0x60, "VANISH_ON", { type: "visible", on: false }],
    [0x61, "VANISH_OFF", { type: "visible", on: true }],
    [0x6a, "PRI_HOLD_SW_ON", { type: "fixedPriority", on: true }],
    [0x6b, "PRI_HOLD_SW_OFF", { type: "fixedPriority", on: false }],
    [0x6c, "AFFUSE_ON", { type: "affine", on: true }],
    [0x6d, "AFFUSE_OFF", { type: "affine", on: false }],
  ];
  for (const [id, name, effect] of toggles) t.set(id, make(id, { sourceName: name, kind: "toggle", effect }));
  const marks: [number, string, string][] = [
    [0x62, "MARK_GYOE", "exclaim"],
    [0x63, "MARK_HATENA", "question"],
    [0x64, "MARK_HEART", "cross"],
    [0x65, "MARK_WGYOE", "doubleExclaim"],
    [0x66, "MARK_NIKO", "smile"],
  ];
  for (const [id, name, mark] of marks) {
    t.set(id, make(id, { sourceName: name, kind: "mark", effect: { type: "mark", mark, frames: MOVEMENT_MARK_FRAMES } }));
  }
  t.set(0x67, make(0x67, { sourceName: "HIDE_PULLOFF", kind: "anim" }));
  t.set(0x68, make(0x68, { sourceName: "ROCK_CRUSH", kind: "anim", framesKnown: false }));
  t.set(0x69, make(0x69, { sourceName: "TREE_CUT", kind: "anim", framesKnown: false }));
  // 拡大しながら下へ 0.5 倍で歩く（`ac_walk05_set` と拡大縮小のアニメ）。
  t.set(0x6e, make(0x6e, { sourceName: "KIOG_WALK_S_D_05", kind: "walk", direction: "down", pixels: WALK_05, tileSteps: [0], sprite: "walk", speed: 0.5, effect: { type: "affine", on: true } }));
  t.set(0x6f, make(0x6f, { sourceName: "KIOG_WALK_D_05", kind: "walk", direction: "down", pixels: WALK_05, tileSteps: [0], sprite: "walk", speed: 0.5, effect: { type: "affine", on: true } }));
  // 0x70〜0x93 は自転車のウィリー。確かめていないので知らない命令にする（下の resolve で）。
  four(t, 0x94, walk("SPINMOVE_x_2", CELL_PATTERNS[2], "spin", 2));
  t.set(0x98, make(0x98, { sourceName: "REVENGE", kind: "anim", framesKnown: false }));
  t.set(0x99, make(0x99, { sourceName: "REVENGE_JUMP", kind: "anim", framesKnown: false }));
  t.set(0x9a, make(0x9a, { sourceName: "REVENGE_SWING", kind: "anim", framesKnown: false }));
  four(t, 0x9b, walk("WALK_x_01", WALK_01, "walk", 0.1));
  t.set(0x9f, make(0x9f, { sourceName: "JIKI_IRAIRA", kind: "anim", framesKnown: false }));
  four(t, 0xa0, walk("NAMINORI_x_2", CELL_PATTERNS[2], "surf", 2));
  // ワープ: 段 0 で高さ 0、20 フレームで 8 画素ずつ -160 まで、最後の段で終わる（22 フレーム）。
  t.set(0xa4, make(0xa4, { sourceName: "WARP_UP", kind: "warp", heights: [0, ...Array.from({ length: 20 }, (_, k) => -8 * (k + 1)), -160], keepHeight: true }));
  t.set(0xa5, make(0xa5, { sourceName: "WARP_DOWN", kind: "warp", heights: [-160, ...Array.from({ length: 20 }, (_, k) => -160 + 8 * (k + 1)), 0] }));
  four(t, 0xa6, swimJump("SWIM_END_JUMP_x"));
  // CFRU の感情アイコン（ND・Chronos の src/emotes.c）。命令は 1 フレームで終わり、アイコンは 60 フレーム出る。
  const emotes = [
    "exclaim",
    "question",
    "ellipsis",
    "double_exclaim",
    "music",
    "mon_exclaim",
    "mon_question",
    "mon_ellipsis",
    "mon_music",
    "mon_heart",
    "mon_poison",
    "mon_happy",
    "mon_very_happy",
    "mon_sad",
    "mon_upset",
    "mon_angry",
  ];
  emotes.forEach((e, i) => {
    const id = 0xaa + i;
    t.set(id, make(id, { sourceName: `EMOTE_${e.toUpperCase()}`, kind: "mark", effect: { type: "mark", mark: `emote_${e}`, frames: MOVEMENT_MARK_FRAMES } }));
  });
  t.set(MOVEMENT_END, make(MOVEMENT_END, { sourceName: "END", kind: "end" }));
  return t;
}

let table: Map<number, MovementAction> | undefined;

/** 番号の命令。表に無い番号は「知らない命令」（1 フレーム）。 */
export function movementAction(id: number): MovementAction {
  table ??= build();
  return table.get(id) ?? make(id, { sourceName: "", kind: "unknown" });
}

/** 表にある番号（小さい順）。 */
export function knownMovementIds(): number[] {
  table ??= build();
  return [...table.keys()].sort((a, b) => a - b);
}

/** 命令の画素の合計（向きの方へ）。動かない命令は 0。 */
export function movementPixelTotal(action: MovementAction): number {
  return action.pixels?.reduce((a, b) => a + b, 0) ?? 0;
}

/** 命令で進むマスの数。 */
export function movementTileTotal(action: MovementAction): number {
  return action.tileSteps.length;
}

/**
 * 番号の名前。プロジェクトの `xse_defines.s` の名前（値 → 名前）を先に見て、無ければ同梱の名前、それも無ければ `0x..`。
 */
export function movementName(id: number, projectNames?: ReadonlyMap<number, string>): string {
  return projectNames?.get(id) ?? BUNDLED_MOVEMENT_NAMES[id.toString(16).padStart(2, "0")] ?? `0x${id.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** 名前から番号（プロジェクトの名前を先に、無ければ同梱の名前）。知らなければ null。 */
export function movementIdByName(name: string, projectNames?: ReadonlyMap<number, string>): number | null {
  if (projectNames) for (const [id, n] of projectNames) if (n === name) return id;
  for (const [hex, n] of Object.entries(BUNDLED_MOVEMENT_NAMES)) if (n === name) return parseInt(hex, 16);
  return null;
}

/** 同じ動きで向きだけ違う命令の番号（向きの 4 つ組の命令だけ。違えば null）。 */
export function movementWithDirection(id: number, direction: MovementDirection): number | null {
  const a = movementAction(id);
  if (a.direction === null) return null;
  const base = id - MOVEMENT_DIRECTIONS.indexOf(a.direction);
  // 向きの 4 つ組か（4 つとも同じ種類で、向きが順に並ぶ）。
  for (let i = 0; i < 4; i++) {
    const b = movementAction(base + i);
    if (b.direction !== MOVEMENT_DIRECTIONS[i] || b.kind !== a.kind || b.sprite !== a.sprite) return null;
  }
  return base + MOVEMENT_DIRECTIONS.indexOf(direction);
}
