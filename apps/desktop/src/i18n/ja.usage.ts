/** 使われている番号の索引と「未使用を選ぶ」（#227）の文言（ZigzaguMap 独自）。 */
export const jaUsage = {
  pick: "未使用",
  pickTitle: (what: string) => `範囲の中で使われていない最小の${what}を入れます（zigzagumap.json の usage で範囲を変えられます）`,
  kind: { flag: "フラグ", var: "変数", hiddenItem: "隠しアイテムの番号", trainer: "トレーナーの番号" } as Readonly<Record<string, string>>,
  building: "使われている番号を調べています…",
  picked: (what: string, value: string) => `未使用の${what} ${value} を入れました`,
  none: (what: string) => `範囲の中に未使用の${what}がありません`,
  failed: (message: string) => `使われている番号を調べられませんでした: ${message}`,
};
