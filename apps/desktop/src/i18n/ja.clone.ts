/** クローンの自動作成（#242）の文言（ZigzaguMap 独自）。 */
export const jaClone = {
  /** 表示 > クローン。 */
  menu: "クローン",
  added: (bank: number, map: number) => `隣のマップ ${bank}.${map} にクローンを作りました`,
  moved: (bank: number, map: number) => `隣のマップ ${bank}.${map} のクローンを動かしました`,
  removed: (bank: number, map: number) => `隣のマップ ${bank}.${map} のクローンを消しました`,
} as const;
