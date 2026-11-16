/** 野生ポケモンタブの時間帯のタブの文言（Phase6 #436。ZigzaguMap 独自）。 */
export const jaWildTime = {
  /** タブの名前（Wild[].Time の 0 朝・1 昼・2 夕・3 夜）。 */
  names: ["朝", "昼", "夕", "夜"] as readonly string[],
  tabHint: (name: string, has: boolean) => (has ? `${name}の表を見る` : `${name}の表はありません（実機では昼の表を使います）`),
  /** 表の無い時間帯。 */
  missing: (name: string) => `${name}の表はありません。実機では、${name}も昼の表を使います（昼の表も無ければ野生は出ません）。`,
  createEmpty: "空の表を作る…",
  copyDay: "昼の表を写して作る",
  remove: "この時間帯の表を消す",
  removed: (name: string) => `${name}の表を消しました（実機では昼の表を使います）`,
  copied: (name: string) => `昼の表を写して${name}の表を作りました`,
} as const;
