/** クローンの自動作成（#242）の文言（ZigzaguMap 独自）。 */
export const jaClone = {
  /** 設定 > クローンを自動で作る。 */
  menu: "隣のマップにクローンを自動で作る",
  added: (bank: number, map: number) => `隣のマップ ${bank}.${map} にクローンを作りました`,
  moved: (bank: number, map: number) => `隣のマップ ${bank}.${map} のクローンを動かしました`,
  removed: (bank: number, map: number) => `隣のマップ ${bank}.${map} のクローンを消しました`,
} as const;
