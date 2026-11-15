// 野生ポケモンの Phase5 の機能（#398）の文言。AdvanceMap に無い機能なので ini には無い。
import { ini } from "./ini";

/** 釣りの竿の名前（0 ボロ・1 いい・2 すごい）。 */
const RODS = ["ボロの釣り竿", "いい釣り竿", "すごい釣り竿"] as const;

export const jaWildTools = {
  rods: RODS,
  /** 枠の横の割合。釣りは竿の名前も付ける。 */
  slotRate: (rate: number, rod: number | null) => (rod === null ? `${rate}%` : `${rate}%（${["ボロ", "いい", "すごい"][rod] ?? ""}）`),
  chartButton: "グラフ…",
  chartTitle: (area: string) => `出現の割合のグラフ（${area}）`,
  chartRod: "釣り竿",
  chartSpecies: "レベルの分布",
  chartAllSpecies: "全部の種族",
  chartTotals: "種族ごとの合計の割合",
  chartLevels: (species: string | null) => (species ? `レベルの分布（${species}）` : "レベルの分布（全部の種族）"),
  chartHover: "棒にマウスを乗せると値を出します。",
  chartBar: (name: string, rate: number) => `${name}: ${formatRate(rate)}%`,
  chartLevel: (level: number, rate: number) => `Lv${level}: ${formatRate(rate)}%`,
  close: "閉じる",
  searchMenu: "野生ポケモンの検索…",
  searchTitle: "野生ポケモンの検索",
  searchSpecies: "種族",
  searchPlaceholder: "名前・読み・番号",
  searchNumber: (n: number) => `No.${n}（0x${n.toString(16).toUpperCase()}）`,
  searchNoMatch: "当たる種族がありません。",
  searchChoose: "種族を選んでください。",
  searchRun: "検索",
  searchColumns: [ini.Menue["114"], "種類", "枠", "レベル", "割合"] as const,
  searchCount: (n: number, maps: number, ms: number) => `${n} 枠（${maps} 枚のマップ、${ms}ms）。行をダブルクリックすると、そのマップの野生タブを開きます。`,
  searchNone: "この種族が出るマップはありません。",
  searchBusy: "全マップの野生を読んでいます…",
  level: (min: number, max: number) => (min === max ? `${min}` : `${min}〜${max}`),
  slot: (n: number) => `${n}`,
};

/** 割合の表記（整数ならそのまま、ほかは小数 1 桁）。 */
function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : rate.toFixed(1);
}
