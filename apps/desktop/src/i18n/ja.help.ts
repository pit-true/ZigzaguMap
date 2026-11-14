/** ヘルプの Read me の窓。 */
export const jaHelpViewer = {
  back: "戻る",
  close: "閉じる",
  /** ヘルプの中では開けない文書へのリンク。 */
  unknownDoc: (path: string) => `ヘルプの中では開けない文書です: ${path}`,
} as const;
