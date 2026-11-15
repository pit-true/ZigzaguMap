/** マップ一覧の状態の印と右クリック（Phase5 #401）の文言（ZigzaguMap 独自）。 */
export const jaMapList = {
  marks: { open: "開いているマップ", dirty: "未出力の変更があるマップ", error: "読み込めなかったマップ" } as Readonly<Record<"open" | "dirty" | "error", string>>,
  menuOpen: "開く",
  menuCopyName: "名前をコピー",
  menuCopyId: "番号（バンク.マップ）をコピー",
  menuDuplicate: "このマップを複製",
  copied: (text: string) => `「${text}」をコピーしました`,
  duplicated: (bank: number, map: number, from: string) => `マップ ${from} を ${bank}.${map} に複製しました（出力で maps\\ に書きます）`,
} as const;
