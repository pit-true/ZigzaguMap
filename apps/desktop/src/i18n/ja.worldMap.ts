import { ini } from "./ini";

const W = ini.WorldMapEditor;

/**
 * ワールドマップエディタの文言。改訂版 Japanese.ini の [WorldMapEditor] の値を使う。
 * ROM へは書き込まないので、「保存」は編集中の状態への確定に読み替える（ファイルへの出力は Ctrl+S の「出力」）。
 */
export const jaWorldMap = {
  title: W.Title,
  posX: W["10"],
  posY: W["11"],
  showEditLayer: W["12"],
  showFlyFlags: W["13"],
  readTopLayer: W["14"],
  changeRoutine: W["15"],
  reload: W["16"],
  saveMap: W["17"],

  mapValue: W["20"],
  nameHeader: W["21"],
  nameOffset: W["22"],
  name: W["23"],
  position: W["24"],
  size: W["25"],
  savePosition: W["26"],
  unset: W["27"],
  baseLayer: W["28"],
  topLayer: W["29"],

  flagLabel: W["30"],
  saveFlag: W["31"],
  routineAlreadyFlags: W["33"],
  routineCanceled: W["35"],
  flagSaveCanceled: W["37"],

  flyPosition: W["40"],
  openThisMap: W["41"],

  townMapNo: W["50"],
  manageNumbers: W["51"],

  saveChanges: W["61"],
  routineAlreadyPositions: W["63"],
  cannotSaveTopPosition: W["64"],

  credit: "Afforded by Mastermind_X",
  question: ini.Allgemein["00"],
  error: ini.Allgemein["02"],
  information: ini.Allgemein["01"],
  /** Delphi のアプリケーションの題名（ini に無い）。 */
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
  noRom: ini.Allgemein["30"],
  /** 値の範囲外。 */
  outOfRange: (field: string, value: number, min: number, max: number) => `${field} の値 ${value} は範囲外です（${min}〜${max}）`,
  mapNameInvalidChar: (char: string) => `名前に使えない文字があります: ${char}`,
  mapNameTooLong: (length: number, max: number) => `名前が長すぎます（${length} バイト、最大 ${max} バイト）`,
} as const;
