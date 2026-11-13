/**
 * 新規マップの作成・作成したマップの保存と読み込み・マップの追加/挿入・マップバンクヘッダーの文言。
 * Japanese.ini の [NewMapForm]・[MapEinfuegenForm]・[MapBankHeaderForm]・[Allgemein] の表記。
 */
export const jaNewMap = {
  // [NewMapForm]（TMapForm）
  dialogTitle: "新しいマップ",
  name: "マップの名前:",
  width: "横幅:",
  height: "高さ:",
  tileset1: "タイルセット１:",
  tileset2: "タイルセット２:",
  create: "作成",
  cancel: "キャンセル",
  fillAll: "すべて記入してください",

  // マップタブの Cmd_MakeMap / Cmd_MakeBank（[Allgemein] 901 / 900）
  makeMap: "新規マップ作成",
  makeBank: "マップバンクの作成",

  // 作成したマップの保存・読み込み
  fileFilter: "AdvanceMap MapDatei",
  openTitle: "ファイルを開く",
  saveTitle: "名前を付けて保存",
  /** [Allgemein] 41。マップファイルの項目のファイルが無いとき。 */
  filesMissing: '作成したマップのファイル"map\\*.evt & map\\*.map"が存在しません！',
  saved: (path: string) => `作成したマップを保存しました: ${path}`,
  invalidMapFile: (reason: string) => `作成したマップのファイルを読めません: ${reason}`,

  // [MapEinfuegenForm]（TMapEinfuegenForm）
  insertTitle: "マップの追加/挿入",
  insertNotice: "※現在のマップ名の位置に保存します",
  currentFile: "ファイル:",
  currentMap: "現在のマップ:",
  insertPosition: "挿入位置:",
  showBankHeader: "マップバンクヘッダーの表示",
  replaceHead: "指定したマップに現在のマップをインポート:",
  bankNumber: "バンク番号:",
  mapNumber: "マップ番号:",
  replace: "指定先にインポート",
  dummyHead: "既存のバンク番号のダミーマップに 現在のマップをインポート:",
  dummyRemaining: "ダミーマップの残量:",
  dummyImport: "ダミーマップにインポート",
  countHead: "指定したバンク番号のダミーマップの総数を変更:",
  countValue: "ダミーマップの総数設定:",
  countApply: "ダミーマップ数の変更",
  addBank: "バンク番号の追加",
  imported: (bank: number, map: number) => `現在のマップデータをコピーし、( ${bank}.${map} ) にマップデータをインポートしました！`,
  insertCanceled: "マップの追加/挿入を中止しました！",
  /** 途中の番号へ挿入しようとしたとき（ZigzaguMap だけの文言）。 */
  slotNotAppend: (bank: number, expected: number) =>
    `バンク ${bank} に新しいマップを加えられるのは末尾（マップ番号 ${expected}）だけです。ZigzaguMap ではマップの配置をビルドが行うため、途中の番号へは挿入できません。`,
  /** 番号を飛ばしてバンクを作ろうとしたとき（ZigzaguMap だけの文言）。 */
  bankSkip: (expected: number) => `新しいバンクは ${expected} 番にだけ作れます（バンク番号を飛ばすことはできません）。`,
  /** 既にある番号へ加えようとしたとき（ZigzaguMap だけの文言）。 */
  mapExists: (bank: number, map: number) => `マップ ${bank}.${map} は既にあります。`,

  // [MapBankHeaderForm]（TMapBankHeaderForm）
  bankTitle: "マップバンクヘッダー",
  bankColumns: "バンク番号：　 マップバンクオフセット:",
  bankCount: "格納マップ数:",
  bankRemaining: "ダミーマップの残量:",
  newBank: "新バンク番号",
  reservedBanks: "Amount of additional reserved Banks:",
  reservedMaps: "Amount of additional reserved Map:",
  bankCancel: "キャンセル",
  bankApply: "変更の適用",
} as const;
