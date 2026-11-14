/** 描く道具（3 層のブロックの選び方と置けない規則、自動ペン、マップ作成補助）の文言（Phase4。ZigzaguMap 独自）。 */

function hex3(n: number): string {
  return n.toString(16).toUpperCase().padStart(3, "0");
}

export const jaPen = {
  /** ステータスバーのブロックの表示に足す（#300）。 */
  tripleSuffix: "　3層",
  tripleUnresolvedSuffix: "　3層（次のブロックが無い）",
  tripleChildSuffix: (parent: number) => `　3層 ${hex3(parent)} の3枚目（単独では置けない）`,
  /** 3 層の次の番号を書かなかったとき（#301）。 */
  tripleChildSkipped: (n: number) => `3層のブロックの3枚目に使われているブロックは置けません（${n} マスを飛ばしました）`,
  /** 表示メニューの印（#301）。 */
  tripleChildMarks: "3層の3枚目のブロックに印を付ける",
};
