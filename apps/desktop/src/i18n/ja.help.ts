/** ヘルプの文言（ZigzaguMap 独自。ショートカットの一覧と、Read me の表示）。 */
export const jaShortcuts = {
  title: "ショートカット一覧",
  note: "入力欄の中では反応しません（Ctrl+Z / Ctrl+Y も、入力欄の中では文字の取り消しになります）。",
  keyHeader: "キー",
  actionHeader: "動作",
  whereHeader: "使える場所",
  anywhere: "どのウィンドウでも",
  mainWindow: "メインのウィンドウ",
  inMenu: "メニューを開いているとき",
  inTree: "マップ一覧",
  inDialog: "画面内のダイアログ",
  inSpin: "上下ボタンつきの数値欄",
  inTrackbar: "野生ポケモンの出現率のトラックバー",
  inPaletteEditor: "パレットエディタの「色の選択」中",
  undo: "元に戻す（メインと同じ履歴）",
  redo: "やり直す",
  menuFocus: "メニューバーへ移る",
  menuOpen: "そのメニューを開く（ファイル(Z)・表示(V)・設定(Y)・ツール(X)・ヘルプ(W)）",
  menuMove: "項目を移る・実行する・閉じる（アクセスキーでも実行）",
  treeMove: "選ぶ項目を移る",
  treeOpenClose: "グループを開く・閉じる（閉じているときの ← は親へ）",
  treeEnter: "選んでいるマップを開く（ダブルクリックと同じ）",
  dialogClose: "閉じる（Cancel・× と同じ。マップコネクションは閉じない）",
  spin: "値を 1 ずつ増やす・減らす",
  trackbar: "← → で 1、PageUp / PageDown で 25 動かす。Home / End で両端",
  stopPicker: "色を拾うのをやめる",
} as const;

/** ヘルプの Read me の窓。 */
export const jaHelpViewer = {
  back: "戻る",
  close: "閉じる",
  /** ヘルプの中では開けない文書へのリンク。 */
  unknownDoc: (path: string) => `ヘルプの中では開けない文書です: ${path}`,
} as const;
