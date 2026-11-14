/** スクリプトのラベルの欄（イベントタブ・マップスクリプトのパネル）の文言（ZigzaguMap 独自）。 */
export const jaScriptLabel = {
  caption: "スクリプトのラベル",
  placeholder: "（ラベルなし）",
  showAll: "マップの .s のラベルを全部出す",
  invalid: (label: string) => `ラベルに使えない名前です: ${label}（半角の英字・数字・_ . $ で、数字で始めない）`,
  missing: (label: string) => `${label} はマップの .s に見つかりません（ビルドで Symbol missing になります）`,
  conditional: (symbols: readonly string[]) => `#ifdef の中の行: ${symbols.join("、")}（ZigzaguMap は変えません）`,
};
