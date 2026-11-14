/**
 * 移動許可（00〜3F）の説明の文言（#308。ZigzaguMap 独自。Bochi の移動エリアの説明と同じ考え方）。
 * 値は「高さ × 4 + 通行」。通行 0 は通れる、1 は通れない、2・3 はゲームでは通れない（ふつうは使わない）。
 */
export const jaMovementInfo = {
  /** 通行の値ごとの説明。 */
  passable: (height: number) => `通れる・高さ ${height}`,
  blocked: (height: number) => `通れない（高さ ${height}）`,
  /** 高さの特別な値。 */
  transition: "通れる・高さの切り替え（どの高さからも入れる。階段や段差の境目に使う）",
  transitionBlocked: "通れない（高さの切り替え）",
  water: "通れる・水面（なみのりで進む高さ）",
  waterBlocked: "通れない（水面の高さ）",
  bridge: "通れる・橋（上と下の 2 つの高さで使える）",
  bridgeBlocked: "通れない（橋の高さ）",
  /** 通行 2・3 の注意。 */
  oddOnly: (collision: number) => `通行の値 ${collision}: ゲームでは通れない。奇数を使う`,
  /** ステータスバーの欄の頭。 */
  label: (value: string) => `移動許可 ${value}: `,
};
