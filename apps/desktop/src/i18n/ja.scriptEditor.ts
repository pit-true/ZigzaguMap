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
  saved: (path: string) => `${path} を保存しました`,
  reloaded: (path: string) => `${path} が外部で変更されたので読み直しました`,
  deleted: (path: string) => `${path} が見つかりません（外部で消されたか、名前が変わりました）。保存すると作り直します`,
  /** タブ・ウィンドウを閉じるときの確認。 */
  confirmSave: (name: string) => `${name} の変更は保存されていません。保存しますか？`,
  confirmSaveMany: (count: number) => `保存していないファイルが ${count} 件あります。保存しますか？`,
  /** 外部で変わったとき（編集中の変更があるとき）。 */
  confirmReload: (name: string) => `${name} が外部で変更されました。読み直しますか？\n「いいえ」で編集中の内容をそのまま残します。`,

  // ---- メイン側 ----
  noProject: "スクリプトを開くには、プロジェクトフォルダ（CFRU-JP のフォルダ）を開いてください",
  notFound: "このイベントのスクリプトが見つかりません（eventscripts にも maps\\scripts.json にも当たる項目がありません）",
  labelNotFound: (label: string) => `ラベル ${label} が assembly の中に見つからないので、マップの .s を開きました`,
  opened: (path: string, line: number) => `${path} の ${line} 行目を開きました`,
  /** メインを閉じる・別のプロジェクトを開くときの確認。 */
  mainDirty: (count: number) => `スクリプトエディタに保存していないファイルが ${count} 件あります。保存しますか？`,
};
