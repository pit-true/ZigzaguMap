import { fmt, ini } from "./ini";

const W = ini.WildePokemon;

/** 出現ポケモンタブ（改訂版 Japanese.ini の [WildePokemon]）の文言。ja.ts の `ja.wild` から使う。 */
export const jaWild = {
  areas: [W["10"], W["11"], W["12"], W["13"]],
  type: W["60"],
  rate: W["61"],
  /** 旧版の [WildePokemon] 63（改訂版に無いので旧版の文言）。 */
  save: "設定の保存",
  /** 旧版の [WildePokemon] 65（改訂版に無いので旧版の文言）。 */
  addType: "タイプの追加",
  level: W["64"],
  species: W["68"],
  slot: (n: number) => fmt(W["70"], n),
  /** 種族のコンボの 0 番。 */
  chooseSpecies: ini.Allgemein["48"],
  /** 種族名が読めないとき（番号で出す）。 */
  speciesNumber: (n: number) => `No.${n}`,
  percent: (rate: number) => `${Math.floor((rate * 100) / 255)}%`,
  noWild: ini.Allgemein["941"],
  create: ini.Allgemein["902"],
  // 追加ダイアログ
  dialogTitle: W["25"],
  dialogHead: W["20"],
  dialogType: W["21"],
  dialogOffset: W["22"],
  cancel: W["23"],
  ok: W["24"],
  /** 何も選ばずに OK（題名「情報」）。 */
  canceled: ini.HeaderVerschieben["13751"],
} as const;
