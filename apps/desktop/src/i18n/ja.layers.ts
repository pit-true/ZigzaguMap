/** レイヤーごとの表示（Phase7 #513。ZigzaguMap 独自）の文言。 */
export const jaLayers = {
  /** 表示メニューの項目。 */
  menu: "レイヤーの表示",
  bottom: "下のレイヤー",
  top: "上のレイヤー",
  third: "トリプルレイヤーの 3 枚目",
  /** ステータスバー（外しているレイヤーがあるとき）。 */
  status: (names: readonly string[]) => `レイヤー: ${names.join("・")}を隠しています`,
  /** ステータスバーの短い名前。 */
  short: { bottom: "下", top: "上", third: "3 枚目" } as Readonly<Record<string, string>>,
  hint: "表示 > レイヤーの表示 で戻せます",
} as const;
