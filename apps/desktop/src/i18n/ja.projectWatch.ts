/** ファイルの変化の監視（Phase5 #404）の文言（ZigzaguMap 独自）。 */
export const jaProjectWatch = {
  title: "ファイルの変化",
  changed: (path: string) => `変更: ${path}`,
  added: (path: string) => `追加: ${path}`,
  removed: (path: string) => `削除: ${path}`,
  more: (n: number) => `ほか ${n} 件`,
  question: (list: string) => `プロジェクトのファイルが、ZigzaguMap の外で変わりました。\n\n${list}\n\n読み直しますか？`,
  discard: (dirty: string, both: string | null) =>
    `未出力の変更があるマップ（${dirty}）があります。読み直すと、これらの変更は捨てられます。${both ? `\n外で変わったファイルのマップ（${both}）にも未出力の変更があります。` : ""}\n\n変更を捨てて読み直しますか？`,
  reloaded: "外で変わったファイルを読み直しました",
} as const;
