/** コネクションマネージャーの別ウィンドウの文言（#561。ZigzaguMap 独自の部分）。 */
export const jaConnectionWindow = {
  /** 接続先の絵の見出し。 */
  preview: "接続先の見た目",
  /** 接続先の名前（絵の下の欄）。 */
  target: (bank: number, map: number, name: string) => `接続先 ${bank}.${map}${name ? ` ${name}` : ""}`,
  /** 接続先が今のマップから離れすぎて見えないとき。 */
  outside: "（ずれが大きく、今のマップの近くに見えません）",
  /** 向きが上下左右でないとき。 */
  notSide: "向きが上・下・左・右のときに、接続先の見た目を出します",
  /** 接続先のマップが無いとき。 */
  noMap: (bank: number, map: number) => `マップ ${bank}.${map} がありません`,
  /** 接続が無いとき。 */
  noConnection: "接続がありません",
} as const;
