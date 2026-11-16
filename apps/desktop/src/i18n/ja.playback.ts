import { ini } from "./ini";
import type { MovementAction, MovementDirection, MovementKind, MovementSprite } from "@zigzagumap/core";

/**
 * スクリプトの再生とタイムライン（Phase6 の #12）の文言。移動コマンドの実際の動きの説明（#448）はここに置き、
 * タイムラインの箱のホバーに出す。
 */

const DIRECTION: Readonly<Record<MovementDirection, string>> = { down: "下", up: "上", left: "左", right: "右" };

const KIND: Readonly<Record<MovementKind, string>> = {
  face: "向きを変える",
  walk: "歩き",
  walkInPlace: "その場で足踏み",
  jump: "ジャンプ",
  wait: "待つ",
  toggle: "切り替え",
  mark: "頭の上の印",
  anim: "絵のアニメ",
  warp: "ワープで消える・降りる",
  end: "終わり",
  unknown: "知らない命令",
};

const SPRITE: Readonly<Record<MovementSprite, string>> = {
  stand: "立ち絵",
  walk: "歩きの絵",
  walkFast: "歩きの絵",
  run: "走りの絵",
  jump: "歩きの絵と影",
  surf: "波乗りの絵",
  spin: "回る絵",
};

/** 倍率の書き方（1.5 倍、0.5 倍）。 */
const speedText = (s: number) => `${s} 倍の速さ`;

export const jaPlayback = {
  menu: "スクリプトを再生",
  projectRequired: "再生するプロジェクトを開いてください。",
  noCommands: "xse_commands.s を読み込めませんでした。",
  noEntry: "再生を始めるラベルが見つかりません。",
  stale: "読み込み中にマップが切り替わりました。",
  noMap: "再生するマップを開いてください。",
  noSprites: "人物の画像の表を読み込めませんでした。",
  noBranch: "選び直せる分岐が見つかりません。",
  noChoice: "選び直せる選択肢が見つかりません。",
  yes: ini.EndnutzerForm["10"], no: ini.EndnutzerForm["11"],
  choiceAnswer: "選択肢の答え（選び直すと計算し直す）",
  choiceNumber: "multichoice の答え（0〜127。127 は B で閉じた）",
  messageFont: "枠と色はROMから表示。文字は確認用フォントです。",
  globalTrack: "全体の印", player: "主人公", camera: "カメラ", person: "人物",
  arrows: { down: "↓", up: "↑", left: "←", right: "→" },
  timeAxis: "フレーム / 秒",
  toggle: "再生・一時停止", previousFrame: "1フレーム戻る", nextFrame: "1フレーム進む", last: "最後へ", shortcutWhere: "再生バー",
  markerNames: { message: "文", choice: "選択", branch: "分岐", camera: "カメラ", shake: "揺れ", fade: "明暗", timeOfDay: "時間帯", unhandled: "未対応", ignored: "未実行", warning: "注意", stop: "終わり", limit: "上限" },
  play: "再生", pause: "一時停止", stop: "再生を終了", first: "最初へ",
  previous: "前の動き", next: "次の動き", male: "男の子", female: "女の子",
  down: "下", up: "上", left: "左", right: "右",
  speed: "再生速度", facing: "主人公の向き", absent: "居ない人物",
  message: "メッセージ", continue: "続きを読む", branch: "分岐", taken: "進む", skipped: "進まない",
  unknown: "読み込めない内容", neutralFrame: "本文の確認用表示",
  label: "再生するラベル",
  status: (frame: number, last: number) => `${frame} / ${last} フレーム（${(frame / 60).toFixed(2)} 秒）`,

  direction: DIRECTION,
  kind: KIND,
  sprite: SPRITE,
  /** フレームと秒（60 フレームで 1 秒）。 */
  frames: (n: number) => `${n} フレーム（${(n / 60).toFixed(2)} 秒）`,
  /**
   * 移動コマンドの実際の動きの説明（例「歩き（下、2 倍の速さ、8 フレーム、歩きの絵）」）。
   * 名前と中身がずれている命令（`run_*`・`slide_*` など）は「名前と動きが違う」を足す。
   */
  movementMotion(a: MovementAction): string {
    const parts: string[] = [];
    if (a.direction) parts.push(DIRECTION[a.direction]);
    if (a.speed !== null) parts.push(speedText(a.speed));
    parts.push(a.framesKnown ? `${a.frames} フレーム` : "長さは絵のデータ次第");
    if (a.sprite && a.kind !== "face") parts.push(SPRITE[a.sprite]);
    const head = a.kind === "walk" && a.tileSteps.length > 0 ? "歩き" : KIND[a.kind];
    const text = `${head}（${parts.join("、")}）`;
    return a.nameMismatch ? `${text}。名前と実際の動きが違う命令` : text;
  },
};
