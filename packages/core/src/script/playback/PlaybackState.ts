import type { MovementDirection, MovementSprite } from "../movement/MovementActionTable.js";
import type { MovementStep } from "../movement/MovementBlock.js";
import type { WalkCommand } from "./ScriptWalker.js";

/**
 * 再生の状態の型（#451）。`Timeline.stateAt(frame)` が返す形で、B の組の人物の絵の部品（#13・#15）と 240×160 の枠の部品に渡す。
 *
 * 位置の決まり:
 * - `pixelX`・`pixelY` はマップの左上からの画素で、人物の立つマスの左上（止まっているときは マス × 16）。歩いている途中は
 *   その間の値。絵はマスの下端に合わせて描く（今の `EventLayer` と同じ）。
 * - `height` はジャンプ・ワープの高さ（画素。マイナスが上）。絵だけを上へずらし、影は地面に出す。
 * - 画面の位置（`camera`）は、追う相手の `pixelX`・`pixelY` にずれ（`offsetX`・`offsetY`）を足したもの。B の枠の部品は、
 *   この点のマスが実画面の左から112px・上から72pxに来るように枠を置く（mapbg.cの縦8pxの補正を含む）。揺れは別に
 *   `shakeX`・`shakeY` で渡す。
 */

/** 主人公の番号。 */
export const PLAYER_ID = 0xff;
/** カメラ（`special 0x113` で作る見えない人物）の番号。 */
export const CAMERA_ID = 0x7f;
/** ND の連れ歩きの番号。 */
export const FOLLOWER_ID = 0xfe;

/** 頭の上の印（出し始めのフレームから {@link MOVEMENT_MARK_FRAMES} 出る）。 */
export interface PlaybackMark {
  /** 印の名前（`exclaim`、`question`、`emote_music` など。移動コマンドの表の効き目と同じ）。 */
  readonly mark: string;
  /** 出し始めてからのフレーム数（0 始まり）。 */
  readonly frame: number;
}

/** 1 人分の、あるフレームの状態。 */
export interface PlaybackActorState {
  /** 人物の番号（マップの localId、主人公 0xFF、カメラ 0x7F、連れ歩き 0xFE）。 */
  readonly id: number;
  /** 絵の番号。カメラは -1（描かない）。 */
  readonly graphicsId: number;
  /** 論理の位置（マス）。歩き始めのフレームで行き先に変わる。 */
  readonly tileX: number;
  readonly tileY: number;
  /** 画素の位置（上の決まり）。 */
  readonly pixelX: number;
  readonly pixelY: number;
  /** 高さ（画素。マイナスが上）。 */
  readonly height: number;
  /** 絵の向き。 */
  readonly facing: MovementDirection;
  /** 絵の種類。止まっていれば stand。 */
  readonly sprite: MovementSprite;
  /** 今の移動コマンドを始めてからのフレーム数（0 始まり）。止まっていれば 0。歩きのコマはこれで選ぶ。 */
  readonly actionFrame: number;
  /** 今の移動コマンドの番号。止まっていれば null。 */
  readonly movementId: number | null;
  /** 見えるか（`set_invisible`・`invisible`・`hidesprite` で false）。 */
  readonly visible: boolean;
  /** マップに居るか（`hidesprite` で消した人物は false）。 */
  readonly present: boolean;
  /** ジャンプの影を出すか。 */
  readonly shadow: boolean;
  /** 頭の上の印。無ければ null。 */
  readonly mark: PlaybackMark | null;
  /** 高さ（マップのデータの elevation）。重なり順に使う。 */
  readonly elevation: number;
  /** 重なり順の固定（`set_fixed_priority`）。 */
  readonly fixedPriority: boolean;
  /** 固定したOBJ同士の重なり順。固定を始めた時の値を保持する。 */
  readonly subpriority?: number | undefined;
  /** 歩きの絵の切り替えを止めているか（`disable_anim`）。 */
  readonly animHold: boolean;
}

/** 画面の位置。 */
export interface PlaybackCamera {
  /** 追う相手の番号。 */
  readonly target: number;
  /** 画面の真ん中に来る点（マップの画素。追う相手の pixelX・pixelY ＋ ずれ）。 */
  readonly x: number;
  readonly y: number;
  /** 揺れ（画素）。 */
  readonly shakeX: number;
  readonly shakeY: number;
}

/** あるフレームの全体の状態。 */
export interface PlaybackState {
  readonly frame: number;
  /** 人物（番号の小さい順。主人公とカメラも入る。マップに居ない人物も present=false で入る）。 */
  readonly actors: readonly PlaybackActorState[];
  readonly camera: PlaybackCamera;
}

/** タイムラインの元の位置（スクリプトの行）。 */
export interface PlaybackSource {
  readonly path: string;
  /** 行（0 始まり）。 */
  readonly line: number;
  /** 命令名の桁。 */
  readonly start: number;
  readonly end: number;
  /** 1 行が複数の命令になるときの何番目か。 */
  readonly part: number;
}

/** 人物の 1 つの移動コマンドの区間。 */
export interface PlaybackSegment {
  readonly actor: number;
  /** 始まりのフレーム。 */
  readonly start: number;
  /** 終わりのフレーム（含む）。 */
  readonly end: number;
  readonly movementId: number;
  /** 前と後のマス。 */
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** その移動データを渡した `applymovement` の場所。 */
  readonly command: PlaybackSource;
  /** 移動データのラベル（ROM のアドレスのときは `0x..`）。 */
  readonly movementLabel: string;
  /** 移動データの何番目か（0 始まり）。 */
  readonly stepIndex: number;
  /** 移動データの中の値の場所（`.s` のものだけ。ROM のものは null）。 */
  readonly step: MovementStep | null;
  /** 移動データのファイル（`.s` のものだけ）。 */
  readonly movementPath: string | null;
}

/** 全体の印の種類。 */
export type PlaybackMarkerKind =
  /** 文（msgbox など）。再生はここで止まる（A-3）。 */
  | "message"
  /** はい・いいえ、選択肢。 */
  | "choice"
  /** 条件分岐（答えを選べる）。 */
  | "branch"
  /** カメラの開始・終了。 */
  | "camera"
  /** 画面の揺れ。 */
  | "shake"
  /** 画面のフェード（時間は 0 として扱う）。 */
  | "fade"
  /** 時間帯の切り替え（Chronos の settimeofday）。 */
  | "timeOfDay"
  /** 表に無い special・callasm（何もしない）。 */
  | "unhandled"
  /** すでに動いている人物への applymovement（無視される）など、動かなかったもの。 */
  | "ignored"
  /** たどるときの注意（壊れたマクロなど）。 */
  | "warning"
  /** スクリプトの終わり、止まったところ。 */
  | "stop"
  /** 60 秒・命令 10,000 個で打ち切った。 */
  | "limit";

/** 全体の印。 */
export interface PlaybackMarker {
  readonly frame: number;
  readonly kind: PlaybackMarkerKind;
  /** 元の場所。無ければ null。 */
  readonly source: PlaybackSource | null;
  /** 中身（文のラベル、special の番号、止まった理由など）。 */
  readonly detail: string;
  /** 分岐なら、その印と答え。 */
  readonly branch: PlaybackBranchMark | null;
}

/** 分岐の印。 */
export interface PlaybackBranchMark {
  /** 答えの表の鍵（`path:line:part#visit`）。 */
  readonly key: string;
  /** 飛んだか。 */
  readonly taken: boolean;
  /** 答えが値から決まったか（true なら選び直せない）。 */
  readonly known: boolean;
  /** 飛び先のラベル。 */
  readonly target: string;
}

/** 実行した命令 1 つ（エディタの行の強調と、タイムラインの 0 フレームの印に使う）。 */
export interface PlaybackCommandRecord {
  readonly frame: number;
  readonly command: WalkCommand;
}

/** WalkCommand から元の位置を作る。 */
export function sourceOf(c: WalkCommand): PlaybackSource {
  return { path: c.path, line: c.line, start: c.start, end: c.end, part: c.part };
}
