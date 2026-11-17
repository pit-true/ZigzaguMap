import { hex } from "./ja";
import { ini } from "./ini";

const PERSON = ini.EventType["00"];
const WARP = ini.EventType["01"];
const SIGN = ini.EventType["03"];
const MAP_SCRIPT = ini.Header["950"];
const FOOTER = ini.Allgemein["64"];

/** ツール > ポインタ一覧（#307）の文言（ZigzaguMap 独自）。 */
export const jaPointers = {
  menu: "ポインタ一覧と参照元の検索",
  title: (bank: number, map: number) => `ポインタ一覧 ${bank}.${map}`,
  titleNone: "ポインタ一覧",
  /** 一覧の上の説明。 */
  romNote: "ベース ROM の上の値です。ZigzaguMap は ROM へ書かないので、調べるためだけに使います。",
  jsonNote: "このマップは maps\\ から読んでいます。下はベース ROM の上の値で、出力したマップのポインタはビルドが付け直します。",
  notInRom: "このマップはベース ROM にありません（maps\\ だけにある新しいマップ）。ポインタはビルドが決めます。",
  noMap: "マップを開いてください。",
  /** 行のイベントが開いているマップに無いとき（maps\ から読んだマップ。#367）。 */
  noEvent: (kind: string, index: number) => `開いているマップに${kind} ${index} はありません（maps\\ のマップは、ベース ROM とイベントの数が違います）`,
  columns: { name: "名前", location: "置き場所", value: "値", bytes: "バイト列" },
  kinds: {
    header: "マップの表（ヘッダーの場所）",
    layout: "ヘッダー: フッター（配置）",
    events: "ヘッダー: イベント",
    scripts: "ヘッダー: マップスクリプト",
    connections: "ヘッダー: 接続",
    border: "フッター: ボーダー",
    blocks: "フッター: ブロックの配置",
    primaryTileset: "フッター: タイルセット 1",
    secondaryTileset: "フッター: タイルセット 2",
    persons: "イベント: 人の一覧",
    warps: "イベント: ワープの一覧",
    traps: "イベント: スクリプトタイルの一覧",
    signs: "イベント: 看板の一覧",
    personScript: PERSON,
    trapScript: "スクリプトタイル",
    signScript: SIGN,
    connectionList: "接続: 一覧",
    mapScript: MAP_SCRIPT,
  } as Readonly<Record<string, string>>,
  /** 番号つきの名前（「人 3 のスクリプト」）。 */
  indexed: (name: string, index: number) => `${name} ${index} のスクリプト`,
  mapScript: (index: number) => `${MAP_SCRIPT} ${index}`,
  none: "（無し）",
  /** 参照元の検索。 */
  searchTitle: "参照元を探す",
  address: "アドレス",
  addressHint: "ROM の上の位置（例: 350A1C）か、ポインタの値（例: 08350A1C）。16 進",
  romBase: "開いているベース ROM",
  romOther: "ほかの ROM のファイル…",
  romOtherPick: "参照元を探す ROM",
  search: "探す",
  searching: (percent: number) => `探しています… ${percent}%`,
  found: (count: number, ms: number, rom: string) => `${count} か所見つかりました（${rom}、${ms.toFixed(0)}ms）`,
  badAddress: "アドレスは 16 進で、ROM の範囲の中で入れてください",
  resultColumns: { location: "場所", where: "中身" },
  unknownPlace: "（マップの表の外）",
  /** 見つかった場所の名前。 */
  place: {
    bankTable: (bank: number) => `バンク表のバンク ${bank}`,
    bankList: (bank: number, map: number) => `マップの表: ${bank}.${map} のヘッダー`,
    header: (bank: number, map: number, field: string) => `マップ ${bank}.${map} のヘッダー（${field}）`,
    layout: (bank: number, map: number, at: number) => `マップ ${bank}.${map} のフッター（+${hex(at, 2)}）`,
    events: (bank: number, map: number, at: number) => `マップ ${bank}.${map} のイベントヘッダー（+${hex(at, 2)}）`,
    list: (bank: number, map: number, kind: string, index: number, at: number) => `マップ ${bank}.${map} の${kind} ${index}（+${hex(at, 2)}）`,
  },
  headerFields: { 0: FOOTER, 4: "イベント", 8: MAP_SCRIPT, 12: "接続" } as Readonly<Record<number, string>>,
  listNames: { persons: PERSON, warps: WARP, traps: "スクリプトタイル", signs: SIGN, connections: "接続", mapScripts: MAP_SCRIPT } as Readonly<Record<string, string>>,
  /** 右クリック。 */
  copyValue: "値をコピー",
  copyBytes: "バイト列をコピー",
  copyLocation: "置き場所をコピー",
  copied: (text: string) => `クリップボードへコピーしました: ${text}`,
  close: "閉じる",
  /** ショートカット一覧（ヘルプ）。 */
  shortcutRowKeys: "行の左クリック",
  shortcutRow: "人・看板・スクリプトタイルのスクリプトの行なら、イベントタブでそのイベントを選ぶ",
  shortcutCopyKeys: "行の右クリック",
  shortcutCopy: "値・バイト列・置き場所をクリップボードへコピーする（参照元の結果の行は置き場所と値）",
  shortcutWhere: "ポインタ一覧のウィンドウの一覧",
  shortcutSearch: "参照元を探す（「探す」と同じ）",
  shortcutSearchWhere: "ポインタ一覧のウィンドウのアドレスの欄",
};
