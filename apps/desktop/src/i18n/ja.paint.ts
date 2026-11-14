/** マップタブの描画の文言（Phase3。ZigzaguMap 独自）。 */
export const jaPaint = {
  /** マップタブの右の欄の「移動許可も貼る」（#225）。 */
  pasteMovements: "移動許可も貼る",
  pasteMovementsHint: "マップから拾った複数選択（Ctrl＋右ドラッグ）を、移動許可ごと貼る",
  copied: (w: number, h: number, withMovements: boolean) => `${w}×${h} をコピーしました${withMovements ? "（移動許可も）" : ""}`,
  nothingToPaste: "貼るものがありません（先に Ctrl+C でコピーしてください）",
  /** ショートカット一覧（#225）。 */
  shortcutCopy: "選んでいるブロック（複数選択）をコピー",
  shortcutPaste: "コピーしたものをマウスの位置に貼る",
  shortcutWhere: "マップタブ",
} as const;
