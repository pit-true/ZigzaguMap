/** スクリプトエディタ（別ウィンドウ）と、メイン側の入口の文言（ZigzaguMap 独自）。 */
export const jaScriptEditor = {
  title: "スクリプトエディタ",
  /** ウィンドウの題名（未保存なら名前の前に ●）。 */
  windowTitle: (name: string | null, dirty: boolean) => (name ? `${dirty ? "● " : ""}${name} - スクリプトエディタ` : "スクリプトエディタ"),
  noFiles: "開いているファイルはありません。イベントをダブルクリックすると、そのスクリプトが開きます。",
  closeTab: "閉じる（Ctrl+W）",
  dirtyMark: "未保存",
  /** 下の帯の、カーソルの位置。 */
  cursor: (line: number, column: number) => `${line} 行、${column} 桁`,
  selected: (chars: number) => `（${chars} 文字を選択）`,
  lineEnding: (ending: string) => `改行 ${ending === "\r\n" ? "CRLF" : ending === "\r" ? "CR" : "LF"}`,
  bom: "BOM 付き",

  notEditable: (path: string) => `このファイルはエディタで開けません（開けるのは assembly/overworld_scripts と strings の中だけです）: ${path}`,
  readFailed: (path: string, error: string) => `${path} を読めませんでした: ${error}`,
  saveFailed: (path: string, error: string) => `${path} を保存できませんでした: ${error}`,
  /** 開いていないファイルをメインの書き込みの列で書こうとしたが、読んでから書くまでの間にほかの書き込みで変わり続けた（#293）。 */
  writeConflict: "ほかの書き込みと重なって書けませんでした。もう一度試してください",
  saved: (path: string) => `${path} を保存しました`,
  reloaded: (path: string) => `${path} が外部で変更されたので読み直しました`,
  deleted: (path: string) => `${path} が見つかりません（外部で消されたか、名前が変わりました）。保存すると作り直します`,
  /** タブ・ウィンドウを閉じるときの確認。 */
  confirmSave: (name: string) => `${name} の変更は保存されていません。保存しますか？`,
  confirmSaveMany: (count: number) => `保存していないファイルが ${count} 件あります。保存しますか？`,
  /** ラベル名の変更（F2）。 */
  renameTitle: "ラベル名の変更",
  renamePrompt: (from: string) => `${from} の新しい名前（assembly/overworld_scripts の .s の定義と参照、イベントのラベルも変えます）`,
  renameInvalid: (name: string) => `ラベルに使えない名前です: ${name}（半角の英字・数字・_ . $ で、数字で始めない）`,
  renamed: (from: string, to: string, count: number, files: number, uses: number) =>
    `${from} を ${to} に変えました（.s ${files} 件の ${count} か所、イベントとマップスクリプト ${uses} 件）`,
  confirmRename: (from: string, to: string, uses: number) =>
    `ラベル ${from} が ${to} に変わりました。${from} を使っているイベントとマップスクリプト（${uses} 件）も ${to} にしますか？`,
  /** 外部で変わったとき（編集中の変更があるとき）。 */
  confirmReload: (name: string) => `${name} が外部で変更されました。読み直しますか？\n「いいえ」で編集中の内容をそのまま残します。`,

  // ---- メイン側 ----
  noProject: "スクリプトを開くには、プロジェクトフォルダ（CFRU-JP のフォルダ）を開いてください",
  notFound: "このイベントのスクリプトが見つかりません（eventscripts にも maps\\scripts.json にも当たる項目がありません）",
  labelNotFound: (label: string) => `ラベル ${label} が assembly の中に見つからないので、マップの .s を開きました`,
  opened: (path: string, line: number) => `${path} の ${line} 行目を開きました`,
  labelMissing: (label: string) => `ラベル ${label} が assembly/overworld_scripts の中に見つかりません`,
  romOpened: (key: string) => `${key} のスクリプトを読み取り専用で開きました`,
  labelRenamed: (from: string, to: string, uses: number) => `ラベル ${from} を ${to} に変えました（イベントとマップスクリプト ${uses} 件。eventscripts は出力のときに書きます）`,
  /** メインを閉じる・別のプロジェクトを開くときの確認。 */
  noReply: "スクリプトエディタが応答しません",
  mainDirty: (count: number) => `スクリプトエディタに保存していないファイルが ${count} 件あります。保存しますか？`,
};

/** 全ファイル検索（Phase7 #520）の文言。 */
export const jaProjectSearch = {
  tabBuild: "ビルド",
  tabSearch: "全ファイル検索",
  placeholder: "全部の .s と .string から探す（Enter）",
  run: "検索",
  close: "閉じる",
  caseSensitive: "大文字と小文字を区別",
  regexp: "正規表現",
  wholeWord: "単語単位",
  scopeAll: ".s と .string",
  scopeAsm: ".s だけ",
  scopeString: ".string だけ",
  searching: "探しています…",
  result: (count: number, files: number, ms: number) => `${count} 行（${files} ファイル、${ms} ms）`,
  truncated: (limit: number) => `。${limit} 件で止めました`,
  none: "見つかりません",
  badRegexp: (message: string) => `正規表現が正しくありません: ${message}`,
  noProject: "プロジェクトフォルダを開いていないので探せません",
} as const;
