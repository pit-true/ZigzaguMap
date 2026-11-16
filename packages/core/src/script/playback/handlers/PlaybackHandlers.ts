import type { PlaybackMarkerKind } from "../PlaybackState.js";
import type { WalkCommand } from "../ScriptWalker.js";

/**
 * `special` の番号と `callasm` の名前 → 再生での処理、の表（#452）。SPEC の「callasm の中のカメラ移動は、C ソースを読んで関数ごとに
 * 再現処理を登録」は、この表に 1 行ずつ足すことにした。表に無い special と callasm は、何もせずに印を出す（結果を変数で返すものは、
 * その後の分岐を画面で選ぶ）。
 *
 * 根拠（FRLG 日本語版のソースと ROM の special の表。ND・Chronos は special の表を差し替えていない）:
 * - 0x113（CAMERA_START、`ScrMapScroolSet`）: 画面が今追っているマスに見えない人物 0x7F を作り、追う相手をそれに替える。画面は動かない。
 * - 0x114（CAMERA_END、`ScrMapScroolReset`）: 追う相手を主人公に戻し、0x7F を消す。画面は動かさない。
 * - 0x136（`AddKodaiMoveTask`）: 0x8004 縦の揺れ幅、0x8005 横の揺れ幅、0x8006 回数、0x8007 間隔。間隔ごとに符号を反転する。
 *   長さを「間隔 × 回数」とするのはソースの読みだけ（エミュレータでは確かめていない）。
 * - 0x111（`AddElevatorMoveTask`）: エレベーターの縦の揺れ。長さは階の差で決まるので、印だけ出す。
 * - callasm `MoveCameraToTrainerB`（ND・Chronos の `src/overworld.c`）: 画面は動かさない。もう 1 人のトレーナーの向きを LASTRESULT に、
 *   0x7F を 0x8005 に入れる。再生ではトレーナー B が分からないので、向きは分からない値にする（後の分岐を画面で選ぶ）。
 * - callasm `HideFollower`（ND の `src/follow_me.c`）: 連れ歩きを見えなくする（A-10）。
 */

/** 処理の中から使える再生の操作。 */
export interface PlaybackHandlerContext {
  /** 今のフレーム。 */
  readonly frame: number;
  /** 変数の値。分からなければ null。 */
  getVar(id: number): number | null;
  /** 変数に入れる（null は「分からない」）。 */
  setVar(id: number, value: number | null): void;
  /** カメラを始める（0x113）。 */
  cameraStart(): void;
  /** カメラを終える（0x114）。 */
  cameraEnd(): void;
  /** 画面を揺らす。frames フレーム続き、`waitstate` はその終わりまで待つ。 */
  shake(dx: number, dy: number, interval: number, frames: number): void;
  /** `waitstate` が待つ長さ（今のフレームから）。 */
  waitState(frames: number): void;
  /** 人物を見せる・見えなくする（居なければ何もしない）。 */
  setVisible(actor: number, visible: boolean): void;
  /** 全体の印を出す。 */
  marker(kind: PlaybackMarkerKind, detail: string): void;
}

/** 処理 1 つ。 */
export interface PlaybackHandler {
  /** 名前（タイムラインの印に出す）。 */
  readonly name: string;
  run(ctx: PlaybackHandlerContext, command: WalkCommand): void;
}

/** 表。 */
export interface PlaybackHandlerTable {
  readonly special: ReadonlyMap<number, PlaybackHandler>;
  /** callasm の名前（書いたままのラベル）→ 処理。 */
  readonly callasm: ReadonlyMap<string, PlaybackHandler>;
}

/** プロジェクトの種類。 */
export type PlaybackProjectKind = "nd" | "chronos" | "rom";

/** 変数の番号。 */
export const VAR_8004 = 0x8004;
export const VAR_8005 = 0x8005;
export const VAR_8006 = 0x8006;
export const VAR_8007 = 0x8007;
export const VAR_LASTRESULT = 0x800d;
export const VAR_LASTTALKED = 0x800f;
export const VAR_FACING = 0x800c;

/** カメラの開始と終了の special の番号。 */
export const SPECIAL_CAMERA_START = 0x113;
export const SPECIAL_CAMERA_END = 0x114;
/** 画面を揺らす special の番号。 */
export const SPECIAL_SHAKE_SCREEN = 0x136;
/** エレベーターの揺れの special の番号。 */
export const SPECIAL_ELEVATOR = 0x111;

const COMMON_SPECIALS: readonly [number, PlaybackHandler][] = [
  [SPECIAL_CAMERA_START, { name: "CAMERA_START", run: (ctx) => ctx.cameraStart() }],
  [SPECIAL_CAMERA_END, { name: "CAMERA_END", run: (ctx) => ctx.cameraEnd() }],
  [
    SPECIAL_SHAKE_SCREEN,
    {
      name: "ShakeScreen",
      run: (ctx) => {
        const dy = ctx.getVar(VAR_8004) ?? 0;
        const dx = ctx.getVar(VAR_8005) ?? 0;
        const count = ctx.getVar(VAR_8006) ?? 0;
        const interval = ctx.getVar(VAR_8007) ?? 1;
        ctx.shake(dx, dy, Math.max(1, interval), Math.max(0, interval * count));
      },
    },
  ],
  [SPECIAL_ELEVATOR, { name: "ElevatorShake", run: (ctx) => ctx.marker("shake", "エレベーターの揺れ（長さは階の差で決まる。再生では 0 フレーム）") }],
];

const ND_CALLASM: readonly [string, PlaybackHandler][] = [
  [
    "MoveCameraToTrainerB",
    {
      name: "MoveCameraToTrainerB",
      run: (ctx) => {
        ctx.setVar(VAR_LASTRESULT, null);
        ctx.setVar(VAR_8005, 0x7f);
      },
    },
  ],
  ["HideFollower", { name: "HideFollower", run: (ctx) => ctx.setVisible(0xfe, false) }],
];

/** プロジェクトの種類ごとの既定の表。 */
export function defaultPlaybackHandlers(kind: PlaybackProjectKind): PlaybackHandlerTable {
  const special = new Map<number, PlaybackHandler>(COMMON_SPECIALS);
  const callasm = new Map<string, PlaybackHandler>(kind === "rom" ? [] : ND_CALLASM);
  return { special, callasm };
}

/** 表に 1 行足した新しい表（元の表は変えない）。 */
export function withPlaybackHandler(table: PlaybackHandlerTable, entry: { special: number } | { callasm: string }, handler: PlaybackHandler): PlaybackHandlerTable {
  if ("special" in entry) return { special: new Map(table.special).set(entry.special, handler), callasm: table.callasm };
  return { special: table.special, callasm: new Map(table.callasm).set(entry.callasm, handler) };
}
