/** フライトポジション（空を飛ぶ・ゲームオーバーの行き先。8 バイト）。AdvanceMap のイベントタブの「フライトポジション」。 */
export interface FlyPosition {
  /** 行き先のバンク番号。 */
  bank: number;
  /** 行き先のマップ番号。 */
  map: number;
  /** 着く位置。 */
  x: number;
  y: number;
  /** 末尾の 2 バイト（AdvanceMap の「不明:」）。 */
  unknown: number;
}
