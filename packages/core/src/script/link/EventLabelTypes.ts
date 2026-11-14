import type { MapScriptTableModel } from "../edit/MapScriptTableText.js";
import type { EventScriptKind } from "../project/eventScriptKinds.js";

// イベントのラベルの持ち方（EventLabelStore）で使う型。

/** ラベルを付けるイベントの並び（人・看板・スクリプトタイル）。 */
export type EventLabelTarget = "person" | "sign" | "tile";

/** 並びの一覧。 */
export const EVENT_LABEL_TARGETS: readonly EventLabelTarget[] = ["person", "sign", "tile"];

/** イベント 1 つのラベル。`kind` は eventscripts に書く種別（人は `npc` / `trainer` / `item`）。 */
export interface EventLabel {
  readonly label: string;
  readonly kind: EventScriptKind;
}

/** マップ 1 枚のラベル（番号はイベントの並びの中の位置）。変えるときは新しいものに置き換える（控えを安く取るため）。 */
export interface MapLabels {
  readonly person: readonly (EventLabel | null)[];
  readonly sign: readonly (EventLabel | null)[];
  readonly tile: readonly (EventLabel | null)[];
  /** マップスクリプトの表のラベル（eventscripts の `map` の行）。 */
  readonly mapScripts: string | null;
  /** ZigzaguMap が `.s` に書く表。 */
  readonly table: MapScriptTableModel | null;
}

/** イベントの座標（照合用）。 */
export interface EventPosition {
  readonly x: number;
  readonly y: number;
}

/** 照合に使う、今のイベントの座標。 */
export type EventPositions = Readonly<Record<EventLabelTarget, readonly EventPosition[]>>;

/** 座標が合わないラベル（Bochi などでイベントの順を変えたかもしれない）。 */
export interface EventLabelMismatch {
  readonly target: EventLabelTarget;
  readonly index: number;
  readonly label: string;
  /** ファイルに書いた座標。 */
  readonly expected: EventPosition;
  /** 今その番号にあるイベントの座標（無ければ null）。 */
  readonly actual: EventPosition | null;
  /** 書いた座標にある、同じ並びのイベントの番号（無いか複数なら null）。 */
  readonly candidate: number | null;
}

/** 控え（取り消し用）。 */
export type EventLabelSnapshot = ReadonlyMap<string, MapLabels>;

/** 出力の計画。 */
export interface EventLabelSavePlan {
  /** 書くラベルのファイル（`text` が null なら消す）。 */
  readonly files: readonly { readonly path: string; readonly text: string | null }[];
  /** 書く eventscripts（変わらなければ null）。 */
  readonly eventScripts: string | null;
  /** `.s` に書き直す表（`table` が null なら消す。`previous` は前の表のラベル）。 */
  readonly tables: readonly { readonly bank: number; readonly map: number; readonly label: string; readonly previous: string | null; readonly table: MapScriptTableModel | null }[];
}
