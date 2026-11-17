import type { PathBlockReason } from "@zigzagumap/core";

/** 道をなぞって移動データを作る窓（#517・#518）の文言。 */
export const jaPathDraw = {
  title: "道をなぞる",
  actor: "動かす人物",
  player: "主人公",
  start: "始めの位置",
  facing: "向き",
  speed: "歩きの速さ",
  wait: "待ち（フレーム）",
  addWait: "待ちを足す",
  undo: "1 つ戻す",
  redo: "やり直す",
  clear: "全部消す",
  close: "閉じる",
  hint: "マップを左ドラッグでなぞる。矢印キーで 1 歩、Ctrl＋矢印で向きだけ、Backspace で 1 つ戻す、Shift＋→ でやり直す。",
  empty: "（まだ命令がありません）",
  count: (n: number) => `${n} 個の命令`,
  waitRow: (frames: number, names: string) => `待ち ${frames} フレーム（${names}）`,
  blocked: (n: number) => `通れないマスがあります（${n} 歩）。スクリプトの移動データは通り抜けて歩きます。`,
  reason: { outside: "マップの外", collision: "通れない移動許可", elevation: "段差（高さが違う）", person: "人物が居る" } satisfies Record<PathBlockReason, string>,
  waitRange: (max: number) => `待ちは 1〜${max} フレームです。`,
  noMap: "マップを開いてください。",
  noActor: (id: number) => `人物（スクリプトの番号 ${id}）がこのマップに居ません。`,
};
