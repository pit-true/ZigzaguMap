import { MAX_MAP_SCRIPT_ENTRIES, isTableType } from "../../../mapscript/layout.js";
import type { MapScriptEntry, MapScriptTable } from "../../../mapscript/types.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";

/** 種類を確かめる（1〜255。0 は一覧の終端と同じなので置けない）。 */
export function checkScriptType(type: number): number {
  if (type === 0) throw new EditError(EditErrorCode.MapScriptTypeUnset);
  return checkRange("type", type, 1, 0xff);
}

/** 番号のマップスクリプトを返す。無ければ EditError（mapScriptIndexOutOfRange）。 */
export function requireScript(doc: MapDocument, index: number): MapScriptEntry {
  const list = doc.mapScripts ?? [];
  const entry = Number.isInteger(index) ? list[index] : undefined;
  if (!entry) throw new EditError(EditErrorCode.MapScriptIndexOutOfRange, { index, count: list.length });
  return entry;
}

/** 条件表を返す。条件表を持たない種類なら EditError（mapScriptNotTable）。 */
export function requireTable(doc: MapDocument, index: number): MapScriptTable {
  const entry = requireScript(doc, index);
  if (!entry.table) throw new EditError(EditErrorCode.MapScriptNotTable, { index, type: entry.type });
  return entry.table;
}

/** 一覧の件数の上限を確かめる。 */
export function checkScriptLimit(count: number): void {
  if (count >= MAX_MAP_SCRIPT_ENTRIES) throw new EditError(EditErrorCode.MapScriptLimit, { max: MAX_MAP_SCRIPT_ENTRIES });
}

/** 条件の変数を確かめる（0 は表の終端と同じなので置けない）。 */
export function checkConditionVariable(variable: number): number {
  if (variable === 0) throw new EditError(EditErrorCode.ConditionVariableZero);
  return checkRange("variable", variable, 1, 0xffff);
}

export { isTableType };
