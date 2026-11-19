/** 場所の設定タブの「このマップの .s」の欄（#555・#562）の文言（ZigzaguMap 独自）。 */
export const jaMapScriptFile = {
  section: "スクリプトのファイル（.s）",
  intro:
    "このマップのイベント（人・看板・スクリプトタイル）とマップスクリプトのスクリプトを書く .s です。下の「マップスクリプト」の表（マップに入ったときなどに動くスクリプトの一覧）とは別の設定です。",
  caption: "このマップの .s",
  none: "（決まっていません）",
  autoMark: "自動（ラベルから）",
  autoNote: (count: number) =>
    `このマップのラベル ${count} 個が書いてある .s を自動で出しています（保存はしていません）。「選ぶ…」で選ぶと、このマップに紐づけて出力で maps\\scripts.json に書きます`,
  fromMap: "このマップに紐づけた .s です（出力で maps\\scripts.json に書きます）",
  fromBank: (bank: number) => `バンク ${bank} の全体の行（対応表）で決まった .s です。「選ぶ…」でこのマップだけの .s にできます`,
  noneNote: "このマップのラベルがどの .s にも見つからないか、1 つの .s に決められません。新しいスクリプトの書き先とラベルの確かめに使う .s を選べます",
  choose: "選ぶ…",
  chooseHint: "プロジェクトの assembly の中の .s を選び、このマップに紐づけます",
  clear: "外す",
  clearHint: "このマップの紐づけを外します（バンク全体の行があれば、その .s に戻ります）",
  dialogTitle: "このマップに紐づける .s を選ぶ",
  filter: "スクリプト（.s）",
  noProject: "プロジェクトフォルダを開いていません",
  outside: (path: string) => `${path} はプロジェクトの assembly の中の .s ではないので、紐づけられません（ビルドが組み立てるのは assembly の中の .s です）`,
  extension: (path: string) => `${path} は .s ではないので、紐づけられません`,
  missing: (path: string) => `${path} がありません`,
  linked: (bank: number, map: number, path: string) => `マップ ${bank}.${map} に ${path} を紐づけました（出力で maps\\scripts.json に書きます）`,
  cleared: (bank: number, map: number) => `マップ ${bank}.${map} の .s の紐づけを外しました`,
} as const;
