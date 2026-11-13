import { fmt, ini } from "./ini";

const N = ini.NewMapForm;
const I = ini.MapEinfuegenForm;
const B = ini.MapBankHeaderForm;

/**
 * 新規マップの作成・作成したマップの保存と読み込み・マップの追加/挿入・マップバンクヘッダーの文言。
 * 改訂版 Japanese.ini の [NewMapForm]・[MapEinfuegenForm]・[MapBankHeaderForm]・[Allgemein] の値を使う。
 */
export const jaNewMap = {
  // [NewMapForm]（TMapForm）
  dialogTitle: N.Title,
  name: N["10"],
  width: N["11"],
  height: N["12"],
  tileset1: N["13"],
  tileset2: N["14"],
  create: N["15"],
  cancel: N["16"],
  fillAll: N["20"],

  // マップタブの Cmd_MakeMap / Cmd_MakeBank（[Allgemein] 901 / 900）
  makeMap: ini.Allgemein["901"],
  makeBank: ini.Allgemein["900"],

  // 作成したマップの保存・読み込み
  fileFilter: "AdvanceMap MapDatei",
  openTitle: "ファイルを開く",
  saveTitle: "名前を付けて保存",
  /** マップファイルの項目のファイルが無いとき。 */
  filesMissing: ini.Allgemein["41"],
  saved: (path: string) => `作成したマップを保存しました: ${path}`,
  invalidMapFile: (reason: string) => `作成したマップのファイルを読めません: ${reason}`,

  // [MapEinfuegenForm]（TMapEinfuegenForm）
  insertTitle: I.Title,
  insertNotice: I["10"],
  currentFile: I["11"],
  currentMap: I["12"],
  insertPosition: I["13"],
  /** 改訂版の 14 は注記だけで空なので、overrides.ini で旧版の文言にしてある。 */
  showBankHeader: I["14"],
  replaceHead: I["20"],
  bankNumber: I["21"],
  mapNumber: I["22"],
  replace: I["23"],
  dummyHead: I["30"],
  dummyRemaining: I["32"],
  dummyImport: I["33"],
  countHead: I["40"],
  countValue: I["42"],
  countApply: I["43"],
  addBank: I["44"],
  imported: (bank: number, map: number) => fmt(I["54"], bank, map),
  insertCanceled: I["56"],
  /** 途中の番号へ挿入しようとしたとき（ZigzaguMap だけの文言）。 */
  slotNotAppend: (bank: number, expected: number) =>
    `バンク ${bank} に新しいマップを加えられるのは末尾（マップ番号 ${expected}）だけです。ZigzaguMap ではマップの配置をビルドが行うため、途中の番号へは挿入できません。`,
  /** 番号を飛ばしてバンクを作ろうとしたとき（ZigzaguMap だけの文言）。 */
  bankSkip: (expected: number) => `新しいバンクは ${expected} 番にだけ作れます（バンク番号を飛ばすことはできません）。`,
  /** 既にある番号へ加えようとしたとき（ZigzaguMap だけの文言）。 */
  mapExists: (bank: number, map: number) => `マップ ${bank}.${map} は既にあります。`,

  // [MapBankHeaderForm]（TMapBankHeaderForm）
  bankTitle: B["15"],
  /** 旧版の 10 は 1 つの見出し、改訂版は 10 と 11 に分かれているのでつなげる。 */
  bankColumns: `${B["10"]}　 ${B["11"]}`,
  bankCount: B["12"],
  bankRemaining: B["13"],
  newBank: B["14"],
  reservedBanks: B["20"],
  reservedMaps: B["21"],
  bankCancel: B["22"],
  bankApply: B["23"],
} as const;
