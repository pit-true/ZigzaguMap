/** 時間帯ビューアの文言（Phase6 #434。ZigzaguMap 独自）。 */
export const jaTimeOfDay = {
  /** 表示 > 時間帯。 */
  menu: "時間帯",
  names: { morning: "朝", day: "昼", evening: "夕", night: "夜" } as Readonly<Record<string, string>>,
  /** ツール欄のコンボの説明。 */
  comboHint: "マップを見せる時間帯（実機の昼夜の色）",
  shown: (name: string, hour: number) => `時間帯: ${name}（${hour} 時の色）`,
  day: "時間帯: 昼（元の色）",
  notTinted: "このマップは時間帯で色が変わりません（屋内・地下・秘密基地など）",
  /** ROM だけのとき（#543。コンボの説明と、切り替えようとしたときのステータスバー）。 */
  noProjectHint: "時間帯の色は、CFRU-JP のフォルダ（プロジェクトのフォルダ）を開くと使えます",
  unreadable: (file: string, line: number | undefined, message: string) => `時間帯の色を読めません: ${file}${line !== undefined ? ` ${line} 行目` : ""}（${message}）`,
};
