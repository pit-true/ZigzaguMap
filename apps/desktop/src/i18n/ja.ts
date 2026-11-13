import { formatHex } from "@zigzagumap/core";
import { jaEvent } from "./ja.event";
import { jaConnection, jaHeader } from "./ja.header";
import { jaWild } from "./ja.wild";
import { fmt, hexList, hexRecord, ini, numbered } from "./ini";

const M = ini.Menue;
const A = ini.Allgemein;
const T = ini.Toolbar;

/**
 * 画面の文言（日本語）。文言はすべてここに集める。
 * AdvanceMap の文言は改訂版の Japanese.ini（source/Japanese.ini）から `ini.節["番号"]` で引く。
 * ini に無い ZigzaguMap 独自の文言だけを直接書く（「ROMの保存」系は「出力」に読み替える）。
 */
export const ja = {
  appTitle: "ZigzaguMap",
  /** マップを開いているときの題名。`item` はマップ一覧の項目の文字列（「マップ名 補足 (B.M)」）。 */
  windowTitle: (item: string) => `ZigzaguMap - ${item}`,

  // [Menue] トップ
  menuFile: M["11"],
  menuSettings: M["12"],
  menuTools: M["13"],
  menuHelp: M["14"],

  // [Menue] ファイル
  openRom: M["110"],
  openProject: "CFRU-JPのフォルダを開く",
  reloadRom: M["111"],
  /** 112「ROMの保存」の読み替え。 */
  exportMaps: "出力",
  /** 113「ROMに名前を付けて保存」の読み替え。 */
  exportMapsTo: "出力先を指定して出力",
  createBackup: M["116"],
  mapMenu: M["114"],
  newMap: M["1140"],
  openCreatedMap: M["1141"],
  saveCreatedMapAs: M["1143"],
  insertMap: M["1144"],
  exit: M["115"],

  // [Menue] 設定
  showGrid: M["120"],
  showObjects: M["123"],
  hideEventPanel: M["124"],
  mapSize: M["126"],
  zoomMap: M["1260"],
  zoomMovement: M["1261"],
  zoomEvent: M["1262"],
  zoomBlockPalette: M["1263"],
  zoomMovementPalette: M["1264"],
  comboBox: M["121"],
  mapDisplay: M["127"],
  mapHeader: M["1270"],
  showIni: M["1271"],
  headerSort: M["1272"],
  createIniFromHeader: M["1273"],
  blockPaletteWidth: M["122"],
  movementOpacity: M["1217"],
  showToolbar: M["1211"],
  language: M["125"],
  rememberLast: M["128"],
  autoSearchOffset: M["1210"],
  advancedHeader: M["129"],
  backupOnOpen: M["1212"],
  createRomShortcut: M["1213"],
  addContextMenu: M["1214"],
  chooseScriptEditor: M["1215"],
  recentSettings: M["1218"],
  recentMax: M["1216"],
  recentClear: M["12180"],
  recentShowPath: M["12181"],
  /** 設定 > 言語（画面は日本語だけなので Japanese の 1 項目）。 */
  languageJapanese: ini["INI-Version"].Sprache,

  // [Menue] ヘッダーのソート
  sortModes: [M["12720"], M["12721"], M["12722"], M["12723"], M["12724"]],

  // [Menue] ツール
  blockEditor: M["130"],
  connections: M["136"],
  worldMapEditor: M["138"],
  previousMap: M["1310"],
  desktopShortcut: M["139"],
  openMapByNumber: M["135"],
  dummyData: M["137"],
  moveBankHeader: M["1370"],
  moveBank: M["1371"],
  moveConnections: M["1372"],
  moveWildHeader: M["1373"],
  manageBankHeader: M["1374"],
  saveMapImage: M["131"],
  saveMapEventImage: M["133"],
  savePaletteImage: M["132"],

  // [Menue] ヘルプ
  readMe: M["140"],
  about: M["141"],
  aboutApp: "ZigzaguMapについて",
  eula: M["142"],
  /** ZigzaguMapについて（[AboutBox] の並び）。 */
  help: {
    aboutTitle: ini.AboutBox.Title,
    credits: ini.AboutBox["11"],
    sections: [
      [
        ini.AboutBox["20"],
        [
          [ini.AboutBox["21"], "pit-true"],
          [ini.AboutBox["23"], "https://github.com/pit-true/ZigzaguMap"],
          [ini.AboutBox["25"], "AdvanceMap 1.92 を再現した CFRU-JP 用のマップエディタです。ROM へは書き込まず、maps\\ の JSON に出力します。"],
        ],
      ],
      [
        "元にしたソフト:",
        [
          [ini.AboutBox["21"], "Advance Map 1.92 (LU-HO Poké)"],
          [
            ini.AboutBox["30"],
            `${ini["INI-Version"].Sprache} ${ini["INI-Version"].Version} (${ini["INI-Version"].Ersteller})`,
          ],
        ],
      ],
    ] as readonly (readonly [string, readonly (readonly [string, string])[]])[],
    version: (v: string) => `ZigzaguMap バージョン: ${v}`,
    license: "ライセンス: MIT",
    copyright: "Copyright (c) 2026 pit-true",
  },

  // 画像の保存（保存ダイアログの文言は AdvanceMap のまま。「Intependent」の綴りも原文どおり）
  saveAsTitle: "名前を付けて保存",
  dibFilter: "Device Intependent Bitmap (*.DIB)",
  allFiles: "All files (*.*)",
  allFilesGerman: "Alle Dateien (*.*)",
  imageSaved: (path: string) => `画像を保存しました: ${path}`,
  // ファイルを開く・PC の設定（[Menue] 12130〜12151、[EndnutzerForm] 30、[KontextMenu] 10 を ZigzaguMap に読み替え）
  openFileTitle: "ファイルを開く",
  programFilter: "Programme (*.exe)",
  notExeFile: M["12150"],
  scriptSeparatorQuestion: M["12151"],
  scriptEditorSet: (path: string) => `スクリプトエディタ: ${path}`,
  romShortcutName: M["12130"],
  romShortcutQuestion:
    "ROM を開くたびに、ZigzaguMap.exe と同じフォルダに「Most recently used ROM.gba.lnk」（最後に開いた ROM のショートカット）を作ります。よろしいですか？",
  desktopShortcutQuestion: ini.EndnutzerForm["30"].replace("AdvanceMap", "ZigzaguMap"),
  desktopShortcutCreated: "デスクトップにショートカットを作成しました",
  contextMenuLabel: "ZigzaguMapで開く",
  contextMenuAddQuestion: "エクスプローラーの .gba の右クリックに「ZigzaguMapで開く」を追加します（現在のユーザーのレジストリに書きます）。よろしいですか？",
  contextMenuRemoveQuestion: "エクスプローラーの右クリックから「ZigzaguMapで開く」を外しますか？",
  skippedInAutomation: "自動操作で起動しているため、PC の設定は変えませんでした",
  notNeededWithoutRomWrite: "ZigzaguMap は ROM へ書き込まないため、この機能は不要です",
  iniFolderTitle: "iniファイル（NewMain.ini と NewMaps.ini）を書き出すフォルダを選んでください",
  iniCreated: (folder: string) => `NewMain.ini と NewMaps.ini を書き出しました: ${folder}`,

  // [Toolbar]（改訂版は番号の並びが 1.92 と違うので、ボタンの役割で対応させる）
  toolbar: {
    open: T["10"],
    /** 11「ROMの保存」の読み替え。 */
    save: "出力",
    newMap: T["12"],
    insertMap: T["13"],
    showObjects: T["15"],
    connections: T["17"],
    blockEditor: T["16"],
    find: T["19"],
    about: T["20"],
    worldMap: T["18"],
    previousMap: T["14"],
  },

  // [Allgemein] タブ
  tabMap: A["20"],
  tabMovement: A["21"],
  tabEvents: A["22"],
  tabWild: A["24"],
  tabHeader: A["25"],

  // [Allgemein] ステータスバー
  statusOpenRom: A["30"],
  statusRomLoaded: A["31"],
  statusMapLoaded: (bank: number, map: number) => `${A["32"]} ${bank}.${map}`,
  /** 読み込みにかかった時間（ミリ秒）。ini の %s に秒を入れる。 */
  statusLoadTime: (ms: number) => fmt(A["110"], (ms / 1000).toFixed(3)),
  statusMapCell: (x: number, y: number, block: string) => `X: ${hex(x, 2)} Y: ${hex(y, 2)}        ${A["33"]} ${block}`,
  statusBlock: (block: number) => `${A["33"]} ${hex(block, 4)}`,
  statusPaletteBlock: (block: number, offset: number | null) =>
    `${A["33"]} ${hex(block, 2)} ${A["34"]} ${offset === null ? "------" : hex(offset, 6)}`,
  statusMovementPalette: (value: number, name: string) => `${A["35"]} ${hex(value, 2)} ${name}`,
  loading: "読み込み中…",
  notImplemented: (name: string) => `未実装: ${name}`,
  error: (message: string) => `${A["02"]}: ${message}`,
  unsupportedFile: "対応していないファイルです（.gba かフォルダを選んでください）",
  exported: (written: number, removed: number) =>
    written + removed === 0 ? "出力するものはありません" : `出力しました（書き込み ${written} 件、削除 ${removed} 件）`,
  exportFolderTitle: "出力先のフォルダ（CFRU-JP のフォルダ）を選んでください",
  projectFolderTitle: "CFRU-JP のフォルダを選んでください",
  needRomForProject: "先にベースROMを選んでください",
  projectOpened: (folder: string) => `プロジェクト: ${folder}`,
  undone: "元に戻しました",
  redone: "やり直しました",
  nothingToUndo: "元に戻す操作はありません",
  nothingToRedo: "やり直す操作はありません",
  dropHint: "ROM（.gba）か CFRU-JP のフォルダをここにドラッグ＆ドロップしてください",

  // [Allgemein] ダイアログ
  question: A["00"],
  information: A["01"],
  errorTitle: A["02"],
  /** 70「変更を保存しますか？」の読み替え。 */
  saveChanges: "変更を出力しますか？",
  openMapTitle: A["42"],
  openMapPrompt: A["43"],
  invalidInput: A["44"],
  mapNotFound: A["100"],
  blockWidthTitle: A["45"],
  blockWidthPrompt: A["46"],
  opacityPrompt: M["12170"],
  recentMaxPrompt: M["12161"],
  ok: ini.EndnutzerForm["13"],
  /** Delphi の入力ダイアログのボタン（ini に無い）。 */
  cancel: "Cancel",
  /** メッセージボックスのボタン（Windows 標準の日本語表記）。 */
  yes: "はい(Y)",
  no: "いいえ(N)",
  cancelJa: ini.EndnutzerForm["12"],
  /** Delphi の StrToInt の例外（AdvanceMap では英語のまま。題名はアプリ名）。 */
  invalidInteger: (text: string) => `'${text}' is not a valid integer value.`,
  /** ROM でないファイルを開いたとき（AdvanceMap の AdvanceMapError(12) の文言）。 */
  unknownRomType: "AdvanceMapError(12): Unknown Rom Type! This Rom cannot be edited with Advancemap.",

  // [Allgemein] マップ一覧
  rootHeader: A["60"],
  rootIni: A["61"],
  rootMapFiles: A["62"],
  noName: A["63"],
  tilesetGroup: (n: number) => `${A["14"]} ${n}`,
  mapItem: (name: string, suffix: string, bank: number, map: number) =>
    suffix ? `${name} ${suffix} (${bank}.${map})` : `${name} (${bank}.${map})`,
  modifiedMark: " *",

  // [RomInfos]
  romInfoName: ini.RomInfos["10"],
  romInfoType: ini.RomInfos["11"],
  romInfoLanguage: ini.RomInfos["12"],
  romInfoVersion: ini.RomInfos["13"],

  // マップタブ
  /** スタンプの窓の題名（AdvanceMap でも日本語化されていない）。 */
  grosserBlock: "Grosser Block",
  borderBlocks: ini.Header["940"],
  selectedBlock: (block: number) => `選択中: ${hex(block, 3)}`,
  selectedStamp: (w: number, h: number) => `選択中: ${w}×${h}`,

  // [Events] [EventMenge] ほか（ja.event.ts）
  event: jaEvent,

  // 場所の設定タブの選択肢（値の先頭に番号が無いので「00-値」の形にする）
  // [NameAnzeigen]
  nameDisplay: numberedList(ini.NameAnzeigen),
  // [Kampftyp]
  battleTypes: numberedList(ini.Kampftyp),
  // [Hoehle]
  caveTypes: numberedList(ini.Hoehle),
  // [Typ]（06・07 は改訂版に無いので旧版の文言）
  mapTypes: numberedList(ini.Typ, { 0x06: "06-道路?(空を飛ぶ可)", 0x07: "07-道路?" }),
  // [Wetter]
  weathers: numberedList(ini.Wetter),
  // [MapScripts]
  mapScriptTypes: hexRecord(ini.MapScripts) as Readonly<Record<number, string>>,
  unknownChoice,

  // [GehDaten] 移動許可の説明（無いものは ???）
  movementNames: hexRecord(ini.GehDaten) as Readonly<Record<number, string>>,
  movementUnknown: "???",

  // 場所の設定タブ・コネクションマネージャー・出現ポケモンタブ（別ファイル）
  header: jaHeader,
  conn: jaConnection,
  wild: jaWild,
} as const;

/** 16 進（大文字、桁そろえ）。 */
export const hex = formatHex;

/** 選択肢に名前が無いときの表示（「0A ???」）。 */
function unknownChoice(value: number): string {
  return `${hex(value, 2)} ???`;
}

/**
 * 節の 00〜最大の番号を「00-値」の形で並べる。
 * 改訂版に無い番号は `fallback`（旧版の文言）、それも無ければ「0A ???」。
 */
function numberedList(section: Readonly<Record<string, string>>, fallback: Readonly<Record<number, string>> = {}): string[] {
  const max = Math.max(...Object.keys(section).filter((k) => /^[0-9A-F]{2}$/i.test(k)).map((k) => parseInt(k, 16)));
  return hexList(section, max + 1).map((v, i) => (v === undefined ? (fallback[i] ?? unknownChoice(i)) : numbered(i, v)));
}

/** 文言の型。 */
export type Messages = typeof ja;
