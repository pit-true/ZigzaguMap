import { hex } from "./ja";

/** パレットの情報表示・最近使ったブロック（#308）の文言（ZigzaguMap 独自）。 */
export const jaPaletteInfo = {
  /** ブロックパレットに乗せたときのステータスバーの欄。 */
  block: (block: number, secondary: boolean) => `ブロック 0x${hex(block, 3)} タイルセット${secondary ? 2 : 1}`,
  behavior: (name: string) => `挙動: ${name}`,
  layer: (name: string) => `重ね方: ${name}`,
  tripleNext: (third: number) => `（トリプルレイヤー。3枚目のレイヤーはブロック 0x${hex(third, 3)} の下のレイヤー）`,
  tripleUnresolved: "（トリプルレイヤー。次のブロックが無いので3枚目のレイヤーは描けない）",
  tripleChild: (parent: number) => `（トリプルレイヤー 0x${hex(parent, 3)} の3枚目のレイヤーに使われる。単独では置けない）`,
  undrawn: "（実機ではこのマスは描かれない）",
  wild: { 1: "野生: 草むら", 2: "野生: 水上" } as Readonly<Record<number, string>>,
  /** 最近使ったブロック。 */
  recentTitle: "最近使ったブロック",
  recentHint: "パレットで選んだブロックとスポイトで拾ったブロック（8 件）。押すと選び直します",
  recentEmpty: "（まだありません）",
  /** ショートカット一覧（ヘルプ）。 */
  shortcutRecentKeys: "左クリック",
  shortcutRecent: "そのブロックを選び直す（パレットの選択も動く）",
  shortcutRecentWhere: "マップタブの最近使ったブロック",
};
