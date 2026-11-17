/** CFRU-JP のフォルダを開く（#540。ZigzaguMap 独自）と、CFRU のソースの場所（#543）の文言。 */
export const jaCfruFolder = {
  /** ファイル > CFRU-JP のフォルダを開く…（一番上。Ctrl+O）。 */
  menu: "CFRU-JP のフォルダを開く…",
  /** フォルダを選ぶダイアログの題。 */
  folderTitle: "CFRU-JP のフォルダを選んでください（中のベース ROM も読み込みます）",
  /** ベース ROM の候補が複数あるとき。 */
  chooseTitle: "ベース ROM を選んでください",
  choosePrompt: (folder: string) => `${folder} の中にベース ROM の候補が複数あります。開く ROM を選んでください。`,
  /** ベース ROM が見つからないとき（ステータスバー。続けて ROM を選ぶダイアログを出す）。 */
  romNotFound: (searched: readonly string[]) => `フォルダの中にベース ROM が見つかりません（探した場所: ${searched.join("、")}）。ROM を選んでください`,
  /** 自動操作の openFolder で、決められなかったとき。 */
  romAmbiguous: (candidates: readonly string[]) => `ベース ROM の候補が複数あります（rom で選んでください）: ${candidates.join("、")}`,
  romMissing: (searched: readonly string[]) => `フォルダの中にベース ROM が見つかりません（探した場所: ${searched.join("、")}）`,
  /** 開いたあとのステータスバー。 */
  opened: (project: string, rom: string) => `CFRU-JP のフォルダを開きました: ${project}（ベース ROM: ${rom}）`,
  /** CFRU のソースが見つからない（#543。どこを探したか）。 */
  sourceMissing: (root: string, searched: readonly string[]) =>
    `CFRU のソースが見つかりません（${root} の ${searched.join("・")} を探しました。CFRU-JP のフォルダを開き直してください）`,
};
