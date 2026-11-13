/** 接続の構造体の大きさとフィールドの位置。 */

/** 接続ヘッダー（件数 u32 + ポインタ）のバイト数。 */
export const CONNECTION_HEADER_SIZE = 8;
/** 接続 1 件のバイト数。 */
export const CONNECTION_SIZE = 12;

/** 接続ヘッダーのフィールド位置。 */
export const CONNECTION_HEADER = {
  count: 0x00,
  connections: 0x04,
} as const;

/** 接続 1 件のフィールド位置。 */
export const CONNECTION = {
  direction: 0x00,
  offset: 0x04,
  bank: 0x08,
  map: 0x09,
  padding: 0x0a,
} as const;

/** 接続の方向。 */
export const ConnectionDirection = {
  None: 0,
  Down: 1,
  Up: 2,
  Left: 3,
  Right: 4,
  Dive: 5,
  Emerge: 6,
} as const;
