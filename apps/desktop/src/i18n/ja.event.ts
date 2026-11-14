import { hex } from "./ja";
import { hexList, ini } from "./ini";

const E = ini.Events;

/**
 * イベントタブの文言（改訂版 Japanese.ini の [Events] [EventType] [EventMenge] [SignpostTyp]
 * [SignpostAnsprechEbene] [Bewegung]）。ja.ts の `event` から使う。
 */
export const jaEvent = {
  /** 種別コンボの並び（AdvanceMap と同じ: 人、看板、ワープ、スクリプト、フライトポジション）。[EventType] */
  kinds: [ini.EventType["00"], ini.EventType["03"], ini.EventType["01"], ini.EventType["02"], ini.EventType["04"]],
  /** ステータスバーの種別名。 */
  kindNames: {
    person: ini.EventType["00"],
    sign: ini.EventType["03"],
    warp: ini.EventType["01"],
    trap: ini.EventType["02"],
    fly: ini.EventType["04"],
  } as Readonly<Record<string, string>>,
  number: E["450"],
  showCursor: E["451"],
  remove: E["452"],
  /** 選んだ種別が 0 件のとき（AdvanceMap はどの種別でもこの文言を出す）。 */
  none: E["945"],
  noEventsInMap: ini.Allgemein["940"],
  /** scripts_MM.json の座標と合わないラベル（ZigzaguMap 独自。#204）。 */
  labelMismatch: (count: number, fixable: number) =>
    `ラベルの照合用の座標と合わないイベントが ${count} 件あります（Bochi などでイベントの順を変えた？）。${fixable > 0 ? `${fixable} 件は書いた座標にあるイベントへ付け替えられます。` : ""}`,
  labelMismatchItem: (label: string, target: string, index: number, x: number, y: number, candidate: number | null) =>
    `${label}: ${target} ${index}（書いた座標 ${x},${y}）${candidate === null ? "" : ` → ${target} ${candidate}`}`,
  labelRealign: "座標で付け直す",
  /** ステータスバーでイベントの無いマス（旧版 [Events] 44 にあたる [EventType] 05）。 */
  noEventAtCell: ini.EventType["05"],
  /** ステータスバー左欄（ホバー）。 */
  status: (x: number, y: number, label: string, offset: number | null) =>
    `X: ${hexCoord(x)} Y: ${hexCoord(y)}        ${label}` + (offset === null ? "" : `        ${ini.Allgemein["34"]} ${hex(offset, 6)}`),
  noteOk: ini.Allgemein["38"],
  noteOutside: ini.Allgemein["37"],
  noteNoEvents: ini.Allgemein["36"],
  /** マップの外のイベントの帯のボタン（ZigzaguMap 独自）。 */
  moveInside: "マップの内側に戻す",

  /** 座標の欄（種別ごとの 400・413・420・430・460 は同じ文言）。 */
  position: E["400"],
  /** 不明の欄（417・419・4113・424・433・461 は同じ文言。人の 412 だけは person.unknown）。 */
  unknown: E["417"],
  /** オフセットの欄（4111・425・434 は同じ文言）。 */
  offset: E["4111"],
  openScript: E["50"],

  person: {
    number: E["410"],
    graphics: E["411"],
    unknown: E["412"],
    elevation: E["414"],
    movement: E["415"],
    range: E["416"],
    trainer: E["418"],
    sight: E["4110"],
    flag: E["4112"],
  },
  warp: {
    elevation: E["401"],
    warpId: E["402"],
    bank: E["403"],
    map: E["404"],
    go: E["405"],
  },
  trap: {
    flagValue: E["421"],
    variable: E["422"],
    value: E["423"],
  },
  sign: {
    elevation: E["431"],
    type: E["432"],
    item: E["435"],
    hiddenId: E["436"],
    amount: E["437"],
  },
  fly: {
    warning: E["462"],
    bank: E["463"],
    map: E["464"],
  },

  // [EventMenge]
  manager: {
    title: ini.EventMenge["10"],
    persons: ini.EventMenge["11"],
    signs: ini.EventMenge["12"],
    warps: ini.EventMenge["13"],
    traps: ini.EventMenge["14"],
    apply: ini.EventMenge["15"],
  },

  /** [SignpostTyp]（コンボの表示は「00 スクリプト(通常)」の形）。 */
  signTypes: present(hexList(ini.SignpostTyp, 9)),
  /** [SignpostAnsprechEbene]（コンボの表示は「00 制限なし」の形）。 */
  signElevations: present(hexList(ini.SignpostAnsprechEbene, 16)),
  /** [Bewegung]（00〜50 の 81 択。添字がそのまま動きの値）。 */
  movementTypes: hexList(ini.Bewegung, 0x51).map((v, i) => `${hex(i, 2)}-${v ?? "???"}`),
  /** アイテム ID のコンボの 1 項目（「マスターボール (0001)」の形）。 */
  itemChoice: (name: string, id: number) => `${name} (${hex(id, 4)})`,

  // ダイアログ
  mapNotFound: ini.Allgemein["100"],
};

/** ステータスバーの座標（範囲内は 2 桁、0x100 以上は 8 桁。AdvanceMap と同じ）。 */
function hexCoord(v: number): string {
  return v > 0xff ? hex(v >>> 0, 8) : hex(v, 2);
}

/** 番号の抜けを「???」で埋める。 */
function present(list: readonly (string | undefined)[]): string[] {
  return list.map((v) => v ?? "???");
}
