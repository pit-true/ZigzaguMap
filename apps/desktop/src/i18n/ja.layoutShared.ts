/** 場所の設定タブの「配置を共有しているマップ」（#228）の文言（ZigzaguMap 独自）。 */
export const jaLayoutShared = {
  section: "配置の共有",
  count: (n: number) => `この配置（ブロックの並び）は ${n} 枚のマップで使われています（ベース ROM）。`,
  note: "ZigzaguMap で描いて出力すると、このマップだけが別の配置になり、ほかのマップは変わりません。",
  mapItem: (bank: number, map: number, name: string | null) => `${bank}.${map}${name ? ` ${name}` : ""}`,
  current: "（表示中）",
};
