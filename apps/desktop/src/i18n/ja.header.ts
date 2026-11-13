/**
 * 場所の設定タブ（[Header] [ProfiHeader] [MapScripts]）の文言。ja.ts の `ja.header` から使う。
 * 選択肢の表（天候・マップタイプなど）は ja.ts のものを使う。
 */
export const jaHeader = {
  // [Header]
  name: "名前:",
  showName: "ワープ時の設定,タイプ",
  saveName: "名前の変更を保存",
  newNameCount: "新しい名前の数:",
  createNames: "新しい名前の作成",
  options: "マップオプション:",
  music: "音楽:",
  weather: "天候:",
  mapType: "マップタイプ:",
  battle: "戦闘背景色の指定(最優先) :",
  cave: "マップの明るさ:",
  musicNo: "音楽No.:",
  tilesets: "使用するタイルセット:",
  tileset1: "タイルセット１:",
  tileset2: "タイルセット２:",
  changeTilesets: "タイルセットの変更",
  size: "マップの大きさ:",
  width: "マップの横幅:",
  height: "マップの高さ:",
  resize: "マップサイズの変更",
  scripts: "マップスクリプト",
  scriptNo: "スクリプトNo:",
  scriptType: "スクリプトタイプ:",
  scriptOffset: "スクリプトオフセット:",
  openScript: "スクリプトを開く",
  saveScripts: "マップスクリプトの保存",
  flag: "フラグ:",
  flagValue: "フラグの値:",
  flagOffset: "フラグのオフセット:",
  removeScript: "選択したスクリプト削除",
  addScript: "スクリプト追加",
  /** 「スクリプトを開く」（外部のスクリプトエディターは未対応）。 */
  openScriptUnsupported: (offset: string) => `スクリプトエディターの呼び出しには未対応です（オフセット ${offset}）`,
  /** 種類 0 のまま保存しようとしたとき。 */
  scriptTypeUnset: (index: number) => `スクリプトNo ${index} の種類が「スクリプト未設定」です。種類を選んでから保存してください`,
  /** 名前表の項目（Cbo_Name）の表記。 */
  nameItem: (name: string) => name,

  // [ProfiHeader]
  bankHeaderGroup: "マップヘッダーの設定:",
  bankHeader: "マップバンクヘッダー:",
  bankNo: "バンク番号:",
  bankOffset: "マップバンクオフセット:",
  mapNo: "マップ番号:",
  headerOffset: "マップヘッダーオフセット:",
  mapGroup: "マップの設定:",
  rawHeader: "マップヘッダー:",
  mapOffset: "マップオフセット:",
  eventOffset: "イベントオフセット:",
  saveReload: "保存してマップの再読み込み",
  scriptsOffset: "マップスクリプトオフセット:",
  connectionOffset: "コネクションオフセット:",
  dataGroup: "マップデータ:",
  rawFooter: "マップフッター:",
  proWidth: "横幅:",
  proHeight: "高さ:",
  blocksOffset: "マップオフセット:",
  borderOffset: "境界線オフセット:",
  tileset1No: "タイルセット1 No.:",
  tileset2No: "タイルセット2 No.:",
  tileset1Offset: "タイルセット1オフセット:",
  tileset2Offset: "タイルセット2オフセット:",
  borderWidth: "境界ブロックの横幅:",
  borderHeight: "境界ブロックの高さ:",
  borderGroup: "境界ブロック",
  border: "境界:",
  tilesetGroup: "タイルセットデータ:",
  tilesetData1: "タイルセット1 :",
  tilesetData2: "タイルセット2 :",

  // エラー（AdvanceMap の文言）
  /** 題名「エラー」。 */
  readAtZero: "AdvanceMapError(1): Try to read at pos 0! Please contakt luhopoke@gmail.com",
  invalidMapSize: "マップの大きさが不正です",
  invalidFooter: "マップフッターのポインタが無効です...",
  mapTooLarge: (width: number, maxHeight: number) => `The max map height at a map width of ${width} is: ${maxHeight}`,
  mapNameInvalidChar: (char: string) => `この文字は使えません: ${char}`,
  mapNameTooLong: (length: number, max: number) => `名前が長すぎます（${length} バイト。最大 ${max} バイト）`,
  invalidRawBytes: (expected: number) => `${expected} バイトの 16 進で入力してください`,
  valueOutOfRange: (field: string, min: number, max: number) => `${field} は ${min}〜${max} の範囲で入力してください`,
} as const;

/** コネクションマネージャー（[AnbindungsForm]）の文言。ja.ts の `ja.conn` から使う。 */
export const jaConnection = {
  title: "コネクションマネージャー",
  group: "コネクション:",
  number: "コネクションNo.:",
  direction: "方向:",
  offset: "調整:",
  bank: "バンク番号:",
  map: "マップ番号:",
  unknown: "不明",
  add: "追加",
  remove: "削除",
  save: "保存",
  /** 方向（0〜6）。 */
  directions: ["無し", "下", "上", "左", "右", "潜る", "出現"],
  emerge: "出現",
  dive: "潜る",
  /** 削除の確認（題名「質問」）。 */
  confirmRemove: (n: number) => `コネクションNo ${n}を削除しますか？`,
} as const;
