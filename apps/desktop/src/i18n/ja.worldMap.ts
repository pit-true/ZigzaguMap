/**
 * ワールドマップエディターの文言。Japanese.ini の [WorldMapEditor] の表記をそのまま使う（コメントの番号は節の中の番号）。
 * ROM へは書き込まないので、「保存」は編集中の状態への確定に読み替える（ファイルへの出力は Ctrl+S の「出力」）。
 */
export const jaWorldMap = {
  title: "ワールドマップエディター", // Titel
  posX: "縦座標", // 10（AdvanceMap では横の値の前に出る）
  posY: "横座標", // 11
  showEditLayer: "エディットレイヤーの表示", // 12
  showFlyFlags: "フライトポジション/人IDの表示", // 13
  readTopLayer: "トップレイヤーの座標を読み込む", // 14
  changeRoutine: "ルーチンの変更", // 15
  reload: "再読み込み", // 16
  saveMap: "マップの保存", // 17

  mapValue: "マップ:", // 20
  nameHeader: "名前のヘッダー:", // 21
  nameOffset: "名前のオフセット:", // 22
  name: "名前:", // 23
  position: "座標(X/Y) :", // 24
  size: "幅/高さ:", // 25
  savePosition: "ポジションの保存", // 26
  unset: "未設定/非表示", // 27
  baseLayer: "基本レイヤー", // 28
  topLayer: "トップレイヤー", // 29

  flagLabel: "この座標の人ID:", // 30
  saveFlag: "フラグの保存", // 31
  routineAlreadyFlags: "人IDのルーチンは既に編集されています。データを書き直しますか？", // 33
  routineCanceled: "人IDのルーチンの変更を中止しました！", // 35
  flagSaveCanceled: "人IDの保存を中止しました！", // 37

  flyPosition: "フライトポジション マップ/座標", // 40
  openThisMap: "このマップを開く", // 41

  townMapNo: "タウンマップNo:", // 50
  manageNumbers: "ワールドマップ番号の管理", // 51

  saveChanges: "ワールドマップの変更を保存しますか？", // 61
  routineAlreadyPositions: "位置決めのルーチンは既に編集されています。データを書き直しますか？", // 63
  cannotSaveTopPosition: "このマップ名のためにトップレイヤーの位置を保存することができません。", // 64

  credit: "Afforded by Mastermind_X",
  question: "質問",
  error: "エラー",
  information: "情報",
  appTitle: "Advance Map",
  /** 16 進・10 進として読めない入力（Delphi の StrToInt の文言）。 */
  invalidInteger: (text: string) => `'${text}' is not a valid integer value.`,
  /** フライト値が無い位置で「このマップを開く」（AdvanceMap の F09-11）。 */
  readAtZero: "AdvanceMapError(1): Try to read at pos 0! Please contakt luhopoke@gmail.com",
  /** ZigzaguMap 独自: ルーチンの変更は ROM を書き換えないので何もしない。 */
  routineNotNeeded: "ZigzaguMap は ROM を書き換えずに人IDとトップレイヤーの位置を読み書きします。ルーチンの変更はビルドのときに regionmap.json の値から行います。",
  /** ZigzaguMap 独自: マップが無い。 */
  mapNotFound: (bank: number, map: number) => `マップ ${bank}.${map} はありません`,
  /** ZigzaguMap 独自: 読み込めない。 */
  loadFailed: (message: string) => `タウンマップを読み込めません: ${message}`,
  /** ZigzaguMap 独自: ROM が開かれていない。 */
  noRom: "ROMを開いてください",
  /** 値の範囲外。 */
  outOfRange: (field: string, value: number, min: number, max: number) => `${field} の値 ${value} は範囲外です（${min}〜${max}）`,
  mapNameInvalidChar: (char: string) => `名前に使えない文字があります: ${char}`,
  mapNameTooLong: (length: number, max: number) => `名前が長すぎます（${length} バイト、最大 ${max} バイト）`,
} as const;
