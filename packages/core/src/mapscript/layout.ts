/** マップスクリプトの構造体の大きさと種類。 */

/** 一覧の 1 件（種類 1 バイト + ポインタ 4 バイト）のバイト数。 */
export const MAP_SCRIPT_ENTRY_SIZE = 5;
/** 一覧の終端（種類 0）のバイト数。 */
export const MAP_SCRIPT_TERMINATOR_SIZE = 1;
/** 条件表の 1 件（変数 u16、値 u16、スクリプト u32）のバイト数。 */
export const MAP_SCRIPT_TABLE_ENTRY_SIZE = 8;
/** 一覧・条件表の件数の上限（Bochi と同じ）。 */
export const MAX_MAP_SCRIPT_ENTRIES = 255;

/** 一覧の 1 件のフィールド位置。 */
export const MAP_SCRIPT_ENTRY = {
  type: 0x00,
  pointer: 0x01,
} as const;

/** 条件表の 1 件のフィールド位置。 */
export const MAP_SCRIPT_TABLE_ENTRY = {
  variable: 0x00,
  value: 0x02,
  script: 0x04,
} as const;

/** マップスクリプトの種類。 */
export const MapScriptType = {
  End: 0,
  OnLoad: 1,
  OnFrameTable: 2,
  OnTransition: 3,
  OnWarpIntoMapTable: 4,
  OnResume: 5,
  OnDiveWarp: 6,
  OnReturnToField: 7,
} as const;

/** 条件表を指す種類か（2 と 4）。 */
export function isTableType(type: number): boolean {
  return type === MapScriptType.OnFrameTable || type === MapScriptType.OnWarpIntoMapTable;
}
