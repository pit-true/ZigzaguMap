/** イベントの複数選択・まとめての移動・削除・複製（Phase5 #399）の文言（ZigzaguMap 独自）。 */
export const jaEventMulti = {
  /** 確認のダイアログの見出し（まとめて消すとき）。 */
  introMany: (n: number) => `${n} 個のイベントを削除します。次のものを消します（1 回の「元に戻す」で全部戻ります）。`,
  deletedMany: (n: number) => `${n} 個のイベントを削除しました`,
  deletedManyWithFiles: (n: number, files: readonly string[]) => `${n} 個のイベントを削除しました（書き換えたファイル: ${files.join("、")}）`,
  selected: (n: number) => `${n} 個のイベントを選んでいます（Shift＋クリックで足す・外す）`,
  duplicated: (n: number) => `${n} 個のイベントを複製しました`,
  duplicatedOne: (what: string, x: number, y: number) => `${what} を (${x}, ${y}) に複製しました`,
  nothingToDuplicate: "複製できるイベントを選んでいません（フライトポジションとクローンは複製しません）",
  skipped: (n: number) => `（フライトポジションとクローンの ${n} 個は複製しません）`,
  /** 右クリックのメニュー。 */
  menuDuplicate: "複製",
  menuDeleteMany: (n: number) => `選んだ ${n} 個を削除`,
  // ショートカットの一覧
  shortcutToggle: "イベントを選びに足す・外す",
  shortcutRect: "矩形の中のイベントを選ぶ",
  shortcutDuplicate: "選んでいるイベントを複製する（1 マス右下に置く）",
  shortcutGroupDrag: "選んでいるイベントをまとめて動かす",
  shortcutWhere: "イベントタブのマップ",
} as const;
