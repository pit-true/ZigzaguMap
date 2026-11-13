import { jaEvent } from "./ja.event";

/**
 * 画面の文言（日本語）。文言はすべてここに集める。
 * AdvanceMap 1.92 日本語化パックの Japanese.ini の表記をそのまま使う（「ROMの保存」系は「出力」に読み替える）。
 * コメントの [節] 番号は Japanese.ini の位置。
 */
export const ja = {
  appTitle: "ZigzaguMap",
  /** 題名（マップを開いたとき）。 */
  windowTitle: (name: string, bank: number, map: number) => `ZigzaguMap - ${name} (${bank}.${map})`,

  // [Menue] トップ
  menuFile: "ファイル",
  menuSettings: "設定",
  menuTools: "ツール",
  menuHelp: "ヘルプ",

  // [Menue] ファイル
  openRom: "ROMを開く",
  openProject: "CFRU-JPのフォルダを開く",
  reloadRom: "ROMの再読み込み",
  exportMaps: "出力",
  exportMapsTo: "出力先を指定して出力",
  createBackup: "バックアップの作成",
  mapMenu: "マップ",
  newMap: "新規マップの作成",
  openCreatedMap: "作成したマップを開く",
  saveCreatedMapAs: "名前をつけて作成したマップを保存",
  insertMap: "マップの追加/挿入",
  exit: "終了",

  // [Menue] 設定
  showGrid: "グリッドの表示",
  showObjects: "オブジェクトの表示",
  hideEventPanel: "イベントパネルの非表示",
  mapSize: "マップサイズの設定",
  zoomMap: "マップの拡大表示",
  zoomMovement: "移動エリアの拡大表示",
  zoomEvent: "イベントの拡大表示",
  zoomBlockPalette: "ブロックパレットの拡大表示",
  zoomMovementPalette: "移動エリアパレットの拡大表示",
  comboBox: "コンボボックス",
  mapDisplay: "マップの表示設定",
  mapHeader: "マップヘッダー",
  showIni: "INIの表示",
  headerSort: "ヘッダーのソート",
  createIniFromHeader: "ヘッダーから新たなIniファイルを作る",
  blockPaletteWidth: "マップブロックの横幅",
  movementOpacity: "移動エリアの設定の透明度",
  showToolbar: "ツールバーの表示",
  language: "言語",
  rememberLast: "最後に選択したものを覚える",
  autoSearchOffset: "自動的にオフセットを検索する",
  advancedHeader: "高度なヘッダーを表示",
  backupOnOpen: "開いたときにバックアップを作成",
  createRomShortcut: "最後に開いたROMのショートカットを作成する",
  addContextMenu: "コンテキストメニューにAM context menuを追加する",
  chooseScriptEditor: "スクリプトエディターの選択",
  recentSettings: "最近開いたファイルの設定",
  recentMax: "最近開いたファイルリストの最大数の変更",
  recentClear: "最近開いたファイルリストの履歴を削除する",
  recentShowPath: "最近開いたファイルリストのファイルパスを表示",
  /** 設定 > 言語 の一覧（AdvanceMap と同じ並び）。 */
  languages: [
    "Deutsch",
    "English",
    "Polish",
    "Français",
    "Netherlands",
    "Español",
    "Suomi",
    "Português",
    "Italiano",
    "Português Brasileiro",
    "Afrikaans",
    "Japanese",
    "Greek",
    "Dansk",
    "Slovensky",
    "Chinese",
    "Korean",
  ],

  // [Menue] ヘッダーのソート
  sortModes: [
    "バンク番号で並び替え",
    "マップの名前で並び替え",
    "タイルセット番号で並び替え",
    "タイルセットのグループで並び替え",
    "マップとタイルセットで並び替え",
  ],

  // [Menue] ツール
  blockEditor: "ブロックエディタ",
  connections: "マップの移動",
  worldMapEditor: "ワールドマップエディター",
  previousMap: "以前開いたマップを開く",
  desktopShortcut: "デスクトップにショートカットを作成",
  openMapByNumber: "マップを指定して開く",
  dummyData: "ダミーデータへ移す/ヘッダー管理",
  moveBankHeader: "マップバンクヘッダーをダミーデータに移す",
  moveBank: "マップバンクをダミーデータに移す",
  moveConnections: "コネクションリストをダミーデータに移す",
  moveWildHeader: "野生のポケモンのヘッダーをダミーデータに移す",
  manageBankHeader: "マップバンクヘッダーの管理",
  saveMapImage: "マップ画像の保存",
  saveMapEventImage: "マップ&イベント画像の保存",
  savePaletteImage: "パレット画像の保存",

  // [Menue] ヘルプ
  readMe: "Read me",
  about: "Advance Mapについて",
  aboutApp: "ZigzaguMapについて",
  eula: "エンドユーザー規約",

  // [Toolbar]
  toolbar: {
    open: "ROMを開く",
    save: "出力",
    newMap: "新規マップの作成",
    insertMap: "マップの追加/挿入",
    showObjects: "オブジェクトの表示",
    connections: "マップの移動",
    blockEditor: "ブロックエディタ",
    find: "ダミーデータの検索",
    about: "インフォメーション",
    worldMap: "ワールドマップエディター",
    previousMap: "以前開いたマップ",
  },

  // [Allgemein] タブ
  tabMap: "マップの設定",
  tabMovement: "移動エリアの設定",
  tabEvents: "イベントの設定",
  tabWild: "出現ポケモン",
  tabHeader: "場所の設定",

  // [Allgemein] ステータスバー
  statusOpenRom: "ROMを開いてください",
  statusRomLoaded: "ROMの読込完了しました マップを選択してください",
  statusMapLoaded: (bank: number, map: number) => `マップの読込完了 ${bank}.${map}`,
  statusLoadTime: (time: string) => `ROMを読み込むのに ${time} 程、時間がかかりました`,
  statusMapCell: (x: number, y: number, block: string) => `X: ${hex(x, 2)} Y: ${hex(y, 2)}        ブロック: ${block}`,
  statusBlock: (block: number) => `ブロック: ${hex(block, 4)}`,
  statusPaletteBlock: (block: number, offset: number | null) =>
    `ブロック: ${hex(block, 2)} オフセット: ${offset === null ? "------" : hex(offset, 6)}`,
  statusMovementPalette: (value: number, name: string) => `ブロック移動：: ${hex(value, 2)} ${name}`,
  noEvents: "イベントはありません.",
  loading: "読み込み中…",
  notImplemented: (name: string) => `未実装: ${name}`,
  error: (message: string) => `エラー: ${message}`,
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
  question: "質問",
  information: "情報",
  errorTitle: "エラー",
  saveChanges: "変更を出力しますか？",
  openMapTitle: "マップを指定して開く",
  openMapPrompt: "マップの番号を指定してください ( 例 : 3.0 ）",
  invalidInput: "それは無効な入力です！正しい値を入力して下さい！",
  mapNotFound: "指定したマップは存在しません！",
  blockWidthTitle: "ブロックの幅の変更",
  blockWidthPrompt: "新しい幅を入力してください。",
  opacityPrompt: "移動エリアの設定のマップの透明度を設定して下さい( 範囲: 0.0 〜 1.0 )",
  recentMaxPrompt: "「ファイル」の下に表示する、最近開いたファイルをいくつリストアップしますか?",
  ok: "OK",
  cancel: "Cancel",

  // [Allgemein] マップ一覧
  rootHeader: "ヘッダー",
  rootIni: "iniファイル",
  rootMapFiles: "マップファイル",
  noName: "名称なし",
  tilesetGroup: (n: number) => `Tileset ${n}`,
  mapItem: (name: string, suffix: string, bank: number, map: number) =>
    suffix ? `${name} ${suffix} (${bank}.${map})` : `${name} (${bank}.${map})`,
  modifiedMark: " *",

  // [RomInfos]
  romInfoName: "ゲーム名:",
  romInfoType: "ROMタイプ:",
  romInfoLanguage: "言語:",
  romInfoVersion: "ROMバージョン:",

  // マップタブ
  borderBlocks: "境界ブロック:",
  selectedBlock: (block: number) => `選択中: ${hex(block, 3)}`,
  selectedStamp: (w: number, h: number) => `選択中: ${w}×${h}`,

  // [Events] [EventMenge] ほか（ja.event.ts）
  event: jaEvent,

  // [WildePokemon]
  wildAreas: ["草むら", "水上", "岩砕き/木", "釣り"],
  wildType: "タイプ:",
  wildRate: "出現確率:",
  wildLevel: "最小/最大 Lv",
  wildSpecies: "Pokemon:",
  wildSlot: (n: number) => `Pokemon${n}:`,
  noWild: "このマップには野生ポケモンが存在しません",

  // [Header]
  headerName: "名前:",
  headerShowName: "ワープ時の設定,タイプ",
  headerOptions: "マップオプション:",
  headerMusic: "音楽:",
  headerMusicNo: "音楽No.:",
  headerWeather: "天候:",
  headerMapType: "マップタイプ:",
  headerBattle: "戦闘背景色の指定(最優先) :",
  headerCave: "マップの明るさ:",
  headerTilesets: "使用するタイルセット:",
  headerTileset1: "タイルセット１:",
  headerTileset2: "タイルセット２:",
  headerSize: "マップの大きさ:",
  headerWidth: "マップの横幅:",
  headerHeight: "マップの高さ:",
  headerScripts: "マップスクリプト",
  headerScriptNo: "スクリプトNo:",
  headerScriptType: "スクリプトタイプ:",
  headerScriptOffset: "スクリプトオフセット:",
  readOnlyNote: "（表示のみ。編集は次の作業で対応します）",

  // [NameAnzeigen]
  nameDisplay: [
    "00-表示しない（ダッシュ不可）",
    "01-表示しない（ダッシュ不可,穴抜け可）",
    "02-表示しない（ダッシュ可）",
    "03-表示しない（ダッシュ可,穴抜け可）",
    "04-表示（ダッシュ不可）",
    "05-表示（ダッシュ不可,穴抜け可）",
    "06-表示 (ダッシュ可）",
    "07-表示（ダッシュ不可,穴抜け可）",
  ],
  // [Kampftyp]
  battleTypes: [
    "00-指定なし",
    "01-ジム戦",
    "02-ロケット団戦",
    "03-通信対人戦？",
    "04-四天王１戦",
    "05-四天王２戦",
    "06-四天王３戦",
    "07-四天王４戦",
    "08-チャンピオン戦",
  ],
  // [Hoehle]
  caveTypes: ["00-普通", "01-周りが見えない/フラッシュ可", "02-周りが見えない/フラッシュ不可"],
  // [Typ]
  mapTypes: [
    "00-指定なし",
    "01-タウン(空を飛ぶ可)",
    "02-シティ(空を飛ぶ可)",
    "03-道路(空を飛ぶ可)",
    "04-洞穴(マップ切替時演出)",
    "05-水中(戦闘背景-水中-,戦闘時演出変更)",
    "06-道路?(空を飛ぶ可)",
    "07-道路?",
    "08-屋内(戦闘背景-屋内-)",
    "09-秘密基地",
  ],
  // [Wetter]
  weathers: [
    "00-無し",
    "01-雲",
    "02-ノーマル",
    "03-雨",
    "04-雪片（※最初だけ）",
    "05-雷雨",
    "06-霧",
    "07-雪（※火山灰）",
    "08-砂嵐",
    "09-霧(※斜流)",
    "0A-薄い霧",
    "0B-少し闇",
    "0C-日本晴れ（※FRフリーズ)",
    "0D-雷雨 タイプ2",
    "0E-水中",
    "0F-無し",
  ],
  // [MapScripts]
  mapScriptTypes: {
    0: "スクリプト未設定",
    1: '"マップタイルのセット"スクリプト',
    2: "フラグ条件達成時、マップ切替時に読込,作動",
    3: "マップ切替時に読込/画面切替では効果なし",
    4: "Validates values, loads handler to 0x03000F28",
    5: "マップ切替時に読込/画面切替でも効果あり",
    7: "マップ切替時に読込/画面切替でも効果あり",
  } as Readonly<Record<number, string>>,
  unknownChoice: (value: number) => `${hex(value, 2)} ???`,

  // [GehDaten] 移動許可の説明（無いものは ???）
  movementNames: {
    0x00: "移動可能エリアを繋ぐ働き",
    0x01: "移動不可エリア",
    0x04: "移動可能エリア(通常波乗り)",
    0x05: "移動不可エリア",
    0x0c: "移動可能エリア2(通常)",
    0x0d: "Solid, Height 2",
    0x10: "主人公をマップの手前に表示(=14と同じレイヤー)",
    0x11: "Solid, Height 3",
    0x14: "移動可能エリア3",
    0x15: "Solid, Height 4",
    0x18: "Passable, Height 5",
    0x19: "Solid, Height 5",
    0x1c: "Passable, Height 6",
    0x1d: "Solid, Height 6",
    0x20: "Passable, Height 7",
    0x21: "Solid, Height 7",
    0x24: "Passable, Height 8",
    0x25: "Solid, Height 8",
    0x28: "Passable, Height 9",
    0x29: "Solid, Height 9",
    0x2c: "Passable, Height 10",
    0x2d: "Solid, Height 10",
    0x30: "Passable, Height 11",
    0x31: "Solid, Height 11",
    0x34: "Passable, Height 12",
    0x35: "Solid, Height 12",
    0x38: "Passable, Height 13",
    0x39: "Solid, Height 13",
    0x3c: "直前のレイヤーと同じ働き",
  } as Readonly<Record<number, string>>,
  movementUnknown: "???",
} as const;

/** 16 進（大文字、桁そろえ）。 */
export function hex(value: number, digits: number): string {
  return value.toString(16).toUpperCase().padStart(digits, "0");
}

/** 文言の型。 */
export type Messages = typeof ja;
