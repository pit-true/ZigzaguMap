import { fmt, hexList, ini } from "./ini";

const H = ini.Header;
const P = ini.ProfiHeader;

/**
 * 場所の設定タブ（改訂版 Japanese.ini の [Header] [ProfiHeader] [MapScripts]）の文言。ja.ts の `ja.header` から使う。
 * 選択肢の表（天候・マップタイプなど）は ja.ts のものを使う。
 */
export const jaHeader = {
  // [Header]
  name: H["900"],
  showName: H["901"],
  saveName: H["902"],
  newNameCount: H["903"],
  createNames: H["904"],
  options: H["910"],
  music: H["911"],
  weather: H["912"],
  mapType: H["913"],
  battle: H["914"],
  cave: H["915"],
  musicNo: H["916"],
  tilesets: H["920"],
  tileset1: H["921"],
  tileset2: H["922"],
  changeTilesets: H["923"],
  size: H["930"],
  width: H["931"],
  height: H["932"],
  resize: H["933"],
  scripts: H["950"],
  scriptNo: H["951"],
  scriptType: H["952"],
  scriptOffset: H["953"],
  openScript: H["954"],
  saveScripts: H["955"],
  flag: H["956"],
  flagValue: H["957"],
  flagOffset: H["958"],
  removeScript: H["9510"],
  addScript: H["9511"],
  /** 「スクリプトを開く」でスクリプトエディタを選んでいないとき。 */
  noScriptEditor: (offset: string) =>
    `スクリプトエディタが選ばれていません（${ini.Menue["12"]} > ${ini.Menue["1215"]}）。${ini.Allgemein["34"]} ${offset}`,
  /** 種類 0 のまま保存しようとしたとき。 */
  scriptTypeUnset: (index: number) => `スクリプトNo.${index} の種類が「${ini.MapScripts["00"]}」です。種類を選んでから保存してください`,
  /** 名前表の項目（Cbo_Name）の表記。 */
  nameItem: (name: string) => name,

  // [ProfiHeader]
  bankHeaderGroup: P["100"],
  bankHeader: P["101"],
  bankNo: P["102"],
  bankOffset: P["103"],
  mapNo: P["104"],
  headerOffset: P["105"],
  mapGroup: P["110"],
  rawHeader: P["111"],
  mapOffset: P["112"],
  eventOffset: P["113"],
  saveReload: P["114"],
  scriptsOffset: P["115"],
  connectionOffset: P["116"],
  dataGroup: P["120"],
  rawFooter: P["121"],
  proWidth: P["122"],
  proHeight: P["123"],
  blocksOffset: P["124"],
  borderOffset: P["125"],
  tileset1No: P["126"],
  tileset2No: P["127"],
  tileset1Offset: P["128"],
  tileset2Offset: P["129"],
  borderWidth: P["132"],
  borderHeight: P["133"],
  borderGroup: P["130"],
  border: P["131"],
  tilesetGroup: P["140"],
  tilesetData1: P["141"],
  tilesetData2: P["142"],

  // エラー（AdvanceMap の文言）
  /** 題名「エラー」。 */
  readAtZero: "AdvanceMapError(1): Try to read at pos 0! Please contakt luhopoke@gmail.com",
  invalidMapSize: "マップのサイズが不正です",
  invalidFooter: ini.Allgemein["83"],
  mapTooLarge: (width: number, maxHeight: number) => fmt(H["9333"], width, maxHeight),
  mapNameInvalidChar: (char: string) => `この文字は使えません: ${char}`,
  mapNameTooLong: (length: number, max: number) => `名前が長すぎます（${length} バイト。最大 ${max} バイト）`,
  invalidRawBytes: (expected: number) => `${expected} バイトの 16 進で入力してください`,
  valueOutOfRange: (field: string, min: number, max: number) => `${field} は ${min}〜${max} の範囲で入力してください`,
} as const;

const C = ini.AnbindungsForm;

/** コネクションマネージャー（[AnbindungsForm] [ConnectionDirections]）の文言。ja.ts の `ja.conn` から使う。 */
export const jaConnection = {
  title: ini.AnbindungsForm.Title,
  group: C["1360"],
  number: C["1361"],
  direction: C["1362"],
  offset: C["1363"],
  bank: C["1364"],
  map: C["1365"],
  unknown: C["1366"],
  add: C["1367"],
  remove: C["1368"],
  save: C["1369"],
  /** 方向（0〜6）。[ConnectionDirections] */
  directions: hexList(ini.ConnectionDirections, 7).map((v) => v ?? "???"),
  emerge: ini.ConnectionDirections["06"],
  dive: ini.ConnectionDirections["05"],
  /** 削除の確認（題名「質問」）。 */
  confirmRemove: (n: number) => fmt(C["13680"], n),
} as const;
