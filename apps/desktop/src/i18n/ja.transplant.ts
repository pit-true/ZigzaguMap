import { formatHex } from "@zigzagumap/core";

/** 別の ROM からタイルセットを取り込む窓（#314）の文言（ZigzaguMap 独自）。 */
export const jaTransplant = {
  menu: "別の ROM からタイルセットを取り込む",
  title: "別の ROM からタイルセットを取り込む",
  pickRom: "ROM を選ぶ…",
  noRom: "取り込む元の ROM を選んでください（FR・LG・エメラルドの日本語版と英語版。読むだけで、書き込みません）。",
  romInfo: (code: string, count: number, path: string) => `${code}（マップ ${count} 枚）　${path}`,
  maps: "マップの一覧",
  preview: "取り込んだ後の絵",
  mapItem: (bank: number, map: number, name: string | null, region: number, w: number, h: number) =>
    `${bank}.${map} ${name ?? `地名 ${formatHex(region, 2)}`}（${w}×${h}）`,
  primary: "主タイルセット",
  secondary: "副タイルセット",
  tilesetInfo: (tiles: number, blocks: number, anime: string) => `タイル ${tiles}・ブロック ${blocks}\nアニメ: ${anime}`,
  animeNone: "なし",
  animeKept: "あり（残す）",
  animeDropped: "あり（取り込み先に同じ処理が無いので外す）",
  notImported: "（取り込まない）",
  parts: "取り込む側",
  partNames: ["両方", "主だけ", "副だけ"] as const,
  copyLayout: "配置も写す（大きさ・配置・ボーダー。イベントは写さない）",
  report: "取り込むと変わること",
  importButton: "取り込む",
  close: "閉じる",

  // 変わることの一覧
  addAs: (bank: number, map: number) => `新しいタイルセットとして加え、今のマップ（${bank}.${map}）の組を付け替えます。今のタイルセットは変えません。`,
  fromEmerald: "エメラルドから FR の形に変えます（副のタイル番号 512 → 640、パレットの本数、属性の 2 バイト → 4 バイト）。",
  asIs: "FR・LG のタイルセットをそのまま写します。",
  packedBlocks: (kept: number, dropped: number) => `副のブロックが FR の上限（384）を超えるので、配置で使う ${kept} 個だけに詰めます（${dropped} 個を外します）。`,
  packedTiles: (kept: number, dropped: number) => `副のタイルが FR の上限（384）を超えるので、使われている ${kept} 枚だけに詰めます（${dropped} 枚を外します）。`,
  unknownBehaviors: (values: readonly number[]) => `FR に無い挙動を 0（地面）にします: ${values.map((v) => formatHex(v, 2)).join("、")}`,
  movedPalette: (from: number, to: number) => `パレット ${from} を ${to} へ動かします。`,
  mergedPalette: (from: number, to: number) => `パレット ${from} は入りきらないので、似た色のパレット ${to} にまとめます。`,
  layout: (w: number, h: number) => `配置とボーダーも写します（大きさ ${w}×${h}）。イベントと接続はそのままです。`,
  imported: (bank: number, map: number) => `取り込みました（マップ ${bank}.${map}）。「元に戻す」1 回で全部戻ります。`,
  noMap: "メインウィンドウでマップを開いてから取り込んでください。",
  openFailed: (message: string) => `この ROM は開けません: ${message}`,
} as const;
