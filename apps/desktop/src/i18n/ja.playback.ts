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
