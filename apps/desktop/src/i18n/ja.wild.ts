/** 出現ポケモンタブ（[WildePokemon]）の文言。ja.ts の `ja.wild` から使う。 */
export const jaWild = {
  areas: ["草むら", "水上", "岩砕き/木", "釣り"],
  type: "タイプ:",
  rate: "出現確率:",
  save: "設定の保存",
  addType: "タイプの追加",
  level: "最小/最大 Lv",
  species: "Pokemon:",
  slot: (n: number) => `Pokemon${n}:`,
  /** 種族のコンボの 0 番。 */
  chooseSpecies: "選択してください",
  /** 種族名が読めないとき（番号で出す）。 */
  speciesNumber: (n: number) => `No.${n}`,
  percent: (rate: number) => `${Math.floor((rate * 100) / 255)}%`,
  noWild: "このマップには野生ポケモンが存在しません",
  create: "野生ポケモンの追加",
  // 追加ダイアログ
  dialogTitle: "野生ポケモンの追加",
  dialogHead: "使用する項目にチェックを入れて下さい",
  dialogType: "タイプ:",
  dialogOffset: "オフセット:",
  cancel: "キャンセル",
  ok: "OK",
  /** 何も選ばずに OK（題名「情報」）。 */
  canceled: "野生ポケモンの出現データの追加/変更を中止しました！",
} as const;
