import type { MapHeaderFields } from "../../../map/MapHeaderCodec.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import type { DocumentContext } from "../../DocumentContext.js";

/** 0x19 のフラグのビット。 */
const ESCAPE_BIT = 0x01;
const RUN_BIT = 0x02;
const SHOW_NAME_SHIFT = 2;

/** ヘッダーの項目と範囲。`allowEscaping` などは 0x19（flags）の一部を指す別名。 */
const HEADER_FIELDS: Readonly<Record<string, { min: number; max: number; bool?: boolean }>> = {
  /** 音楽（u16）。 */
  music: { min: 0, max: 0xffff },
  /** レイアウト番号（u16）。 */
  layoutId: { min: 0, max: 0xffff },
  /** マップ名 ID（地名番号）。 */
  regionMapSectionId: { min: 0, max: 0xff },
  /** マップの明るさ（洞窟）。 */
  cave: { min: 0, max: 0xff },
  /** 天候。 */
  weather: { min: 0, max: 0xff },
  /** マップタイプ。 */
  mapType: { min: 0, max: 0xff },
  /** 自転車に乗れるか。 */
  bikingAllowed: { min: 0, max: 0xff },
  /** 0x19 のバイト全体（AdvanceMap の「ワープ時の設定,タイプ」= 名前表示・ダッシュ・穴抜け）。 */
  flags: { min: 0, max: 0xff },
  /** 階数（符号つき）。 */
  floorNum: { min: -128, max: 127 },
  /** 戦闘背景。 */
  battleType: { min: 0, max: 0xff },
  /** 穴抜けできるか（flags のビット 0）。 */
  allowEscaping: { min: 0, max: 1, bool: true },
  /** 走れるか（flags のビット 1）。 */
  allowRunning: { min: 0, max: 1, bool: true },
  /** 名前を表示するか（flags のビット 2〜7。FR で使うのは 0 か 1）。 */
  showMapName: { min: 0, max: 0x3f },
};

/** ヘッダーの項目名の一覧。 */
export const HEADER_FIELD_NAMES: readonly string[] = Object.keys(HEADER_FIELDS);

/** ヘッダーの項目を確かめ、書いた後のヘッダーを返す（元は変えない）。違えば EditError。 */
export function applyHeaderFields(header: MapHeaderFields, fields: Readonly<Record<string, number | boolean>>): MapHeaderFields {
  const next = { ...header };
  for (const [field, raw] of Object.entries(fields)) {
    const spec = Object.prototype.hasOwnProperty.call(HEADER_FIELDS, field) ? HEADER_FIELDS[field] : undefined;
    if (!spec) throw new EditError(EditErrorCode.UnknownField, { field });
    const value = typeof raw === "boolean" ? (spec.bool ? Number(raw) : NaN) : raw;
    checkRange(field, value, spec.min, spec.max);
    switch (field) {
      case "allowEscaping":
        next.flags = (next.flags & ~ESCAPE_BIT) | (value ? ESCAPE_BIT : 0);
        break;
      case "allowRunning":
        next.flags = (next.flags & ~RUN_BIT) | (value ? RUN_BIT : 0);
        break;
      case "showMapName":
        next.flags = (next.flags & (ESCAPE_BIT | RUN_BIT)) | (value << SHOW_NAME_SHIFT);
        break;
      default:
        (next as unknown as Record<string, number>)[field] = value;
    }
  }
  return next;
}

/** ヘッダーを差し替える。地名番号が変わったときは、マップ名をその番号の名前にする。 */
export function replaceHeader(doc: MapDocument, header: MapHeaderFields, context: DocumentContext): void {
  const regionChanged = header.regionMapSectionId !== doc.header.regionMapSectionId;
  doc.header = header;
  if (regionChanged) {
    const name = context.mapName(header.regionMapSectionId);
    doc.mapName = name ? name.slice() : null;
  }
}
