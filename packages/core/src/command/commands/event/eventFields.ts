import { signCodec } from "../../../event/SignCodec.js";
import type { MapEvents, PersonEvent, SignEvent, TrapEvent, WarpEvent } from "../../../event/types.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";

/** イベントの種類（AdvanceMap の 人 / ワープ / スクリプト / 看板）。 */
export const EVENT_KINDS = ["person", "warp", "trap", "sign"] as const;
/** イベントの種類。 */
export type EventKind = (typeof EVENT_KINDS)[number];

/** 1 種類のイベントの数の上限（AdvanceMap のイベントマネージャーと同じ 255）。 */
export const MAX_EVENTS_PER_KIND = 255;

/** 項目の値の範囲。`bool` は true / false（0 / 1 も可）。 */
interface FieldSpec {
  readonly min: number;
  readonly max: number;
  readonly bool?: boolean;
}

const U8: FieldSpec = { min: 0, max: 0xff };
const U16: FieldSpec = { min: 0, max: 0xffff };
const U32: FieldSpec = { min: 0, max: 0xffffffff };
const NIBBLE: FieldSpec = { min: 0, max: 0xf };

/** 人の項目。 */
const PERSON_FIELDS: Readonly<Record<keyof PersonEvent, FieldSpec>> = {
  localId: U8,
  graphicsId: U8,
  kind: U8,
  padding1: U8,
  x: U16,
  y: U16,
  elevation: U8,
  movementType: U8,
  movementRangeX: NIBBLE,
  movementRangeY: NIBBLE,
  padding2: U8,
  trainerType: U16,
  trainerRangeOrBerryTree: U16,
  script: U32,
  flag: U16,
  padding3: U16,
};

/** ワープの項目。 */
const WARP_FIELDS: Readonly<Record<keyof WarpEvent, FieldSpec>> = {
  x: U16,
  y: U16,
  elevation: U8,
  warpId: U8,
  map: U8,
  bank: U8,
};

/** スクリプトタイルの項目。 */
const TRAP_FIELDS: Readonly<Record<keyof TrapEvent, FieldSpec>> = {
  x: U16,
  y: U16,
  elevation: U8,
  padding1: U8,
  variable: U16,
  value: U16,
  padding2: U16,
  script: U32,
};

/** 看板の共通の項目。 */
const SIGN_FIELDS: Readonly<Record<string, FieldSpec>> = {
  x: U16,
  y: U16,
  elevation: U8,
  kind: U8,
  padding: U16,
};
/** 看板（スクリプト）だけの項目。 */
const SIGN_SCRIPT_FIELDS: Readonly<Record<string, FieldSpec>> = { script: U32 };
/** 看板（隠しアイテム）だけの項目。 */
const SIGN_HIDDEN_FIELDS: Readonly<Record<string, FieldSpec>> = {
  item: U16,
  flag: U8,
  amount: { min: 0, max: 0x7f },
  underfoot: { min: 0, max: 1, bool: true },
};

/** 種類ごとの項目の一覧（画面の欄の作成用）。 */
export const EVENT_FIELD_NAMES: Readonly<Record<EventKind, readonly string[]>> = {
  person: Object.keys(PERSON_FIELDS),
  warp: Object.keys(WARP_FIELDS),
  trap: Object.keys(TRAP_FIELDS),
  sign: [...Object.keys(SIGN_FIELDS), ...Object.keys(SIGN_SCRIPT_FIELDS), ...Object.keys(SIGN_HIDDEN_FIELDS)],
};

/** イベントの一覧（種類別）。 */
export function eventList(events: MapEvents, kind: EventKind): object[] {
  switch (kind) {
    case "person":
      return events.persons;
    case "warp":
      return events.warps;
    case "trap":
      return events.traps;
    case "sign":
      return events.signs;
  }
}

/** 番号のイベントがあるか確かめ、無ければ EditError（eventIndexOutOfRange）。 */
export function requireEvent(doc: MapDocument, kind: EventKind, index: number): object {
  const list = doc.events ? eventList(doc.events, kind) : [];
  const event = Number.isInteger(index) ? list[index] : undefined;
  if (!event) throw new EditError(EditErrorCode.EventIndexOutOfRange, { kind, index, count: list.length });
  return event;
}

/**
 * AdvanceMap で増やしたときの初期値（全部 0）。人の番号（localId）だけは
 * AdvanceMap の「人 No.」の表示（添字 + 1）に合わせる。
 */
export function newEvent(kind: EventKind, index: number): PersonEvent | WarpEvent | TrapEvent | SignEvent {
  switch (kind) {
    case "person":
      return {
        localId: (index + 1) & 0xff,
        graphicsId: 0,
        kind: 0,
        padding1: 0,
        x: 0,
        y: 0,
        elevation: 0,
        movementType: 0,
        movementRangeX: 0,
        movementRangeY: 0,
        padding2: 0,
        trainerType: 0,
        trainerRangeOrBerryTree: 0,
        script: 0,
        flag: 0,
        padding3: 0,
      };
    case "warp":
      return { x: 0, y: 0, elevation: 0, warpId: 0, map: 0, bank: 0 };
    case "trap":
      return { x: 0, y: 0, elevation: 0, padding1: 0, variable: 0, value: 0, padding2: 0, script: 0 };
    case "sign":
      return { x: 0, y: 0, elevation: 0, kind: 0, padding: 0, content: { type: "script", script: 0 } };
  }
}

/**
 * 項目の値を確かめて、書く値（真偽値の項目は boolean、それ以外は数）にする。違えば EditError。
 * 看板は、いまの種別（変える場合は変えた後の種別）で使える項目だけを受け付ける。
 */
export function checkEventField(kind: EventKind, event: object, field: string, value: number | boolean, signHidden?: boolean): number | boolean {
  let spec: FieldSpec | undefined;
  if (kind === "sign") {
    const hidden = signHidden ?? (event as SignEvent).content.type === "hiddenItem";
    spec = SIGN_FIELDS[field] ?? (hidden ? SIGN_HIDDEN_FIELDS[field] : SIGN_SCRIPT_FIELDS[field]);
    if (!spec && (SIGN_HIDDEN_FIELDS[field] || SIGN_SCRIPT_FIELDS[field])) {
      throw new EditError(EditErrorCode.FieldNotApplicable, { field, kind: (event as SignEvent).kind });
    }
  } else {
    const table: Readonly<Record<string, FieldSpec>> = kind === "person" ? PERSON_FIELDS : kind === "warp" ? WARP_FIELDS : TRAP_FIELDS;
    spec = Object.prototype.hasOwnProperty.call(table, field) ? table[field] : undefined;
  }
  if (!spec) throw new EditError(EditErrorCode.UnknownField, { field });
  if (spec.bool) {
    if (typeof value === "boolean") return value;
    return checkRange(field, value, 0, 1) === 1;
  }
  if (typeof value !== "number") throw new EditError(EditErrorCode.ValueOutOfRange, { field, value: String(value), min: spec.min, max: spec.max });
  return checkRange(field, value, spec.min, spec.max);
}

/** 看板の種別を変える。中身の 4 バイトはそのままで、新しい種別として読み直す（AdvanceMap と同じ）。 */
export function reinterpretSign(sign: SignEvent, kind: number): SignEvent {
  const bytes = signCodec.encode(sign);
  bytes[5] = kind;
  return signCodec.decode(bytes);
}

/** 確かめた値を書く（看板の種別は reinterpretSign で先に変えておくこと）。 */
export function writeEventField(kind: EventKind, event: object, field: string, value: number | boolean): void {
  if (kind === "sign" && !(field in SIGN_FIELDS)) {
    Object.assign((event as SignEvent).content, { [field]: value });
    return;
  }
  Object.assign(event, { [field]: value });
}
