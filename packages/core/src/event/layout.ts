/** イベント関係の構造体の大きさとフィールドの位置。 */

/** イベントヘッダー（件数 4 つ + ポインタ 4 つ）のバイト数。 */
export const EVENT_HEADER_SIZE = 20;
/** 人のバイト数。 */
export const PERSON_SIZE = 24;
/** ワープのバイト数。 */
export const WARP_SIZE = 8;
/** スクリプトタイルのバイト数。 */
export const TRAP_SIZE = 16;
/** 看板のバイト数。 */
export const SIGN_SIZE = 12;

/** イベントヘッダーのフィールド位置。 */
export const EVENT_HEADER = {
  personCount: 0x00,
  warpCount: 0x01,
  trapCount: 0x02,
  signCount: 0x03,
  persons: 0x04,
  warps: 0x08,
  traps: 0x0c,
  signs: 0x10,
} as const;

/** 人のフィールド位置。 */
export const PERSON = {
  localId: 0x00,
  graphicsId: 0x01,
  kind: 0x02,
  padding1: 0x03,
  x: 0x04,
  y: 0x06,
  elevation: 0x08,
  movementType: 0x09,
  /** 下位 4 ビットが X、上位 4 ビットが Y。 */
  movementRange: 0x0a,
  padding2: 0x0b,
  trainerType: 0x0c,
  trainerRangeOrBerryTree: 0x0e,
  script: 0x10,
  flag: 0x14,
  padding3: 0x16,
} as const;

/** ワープのフィールド位置。 */
export const WARP = {
  x: 0x00,
  y: 0x02,
  elevation: 0x04,
  warpId: 0x05,
  map: 0x06,
  bank: 0x07,
} as const;

/** スクリプトタイルのフィールド位置。 */
export const TRAP = {
  x: 0x00,
  y: 0x02,
  elevation: 0x04,
  padding1: 0x05,
  variable: 0x06,
  value: 0x08,
  padding2: 0x0a,
  script: 0x0c,
} as const;

/** 看板のフィールド位置。 */
export const SIGN = {
  x: 0x00,
  y: 0x02,
  elevation: 0x04,
  kind: 0x05,
  padding: 0x06,
  /** 種別によりスクリプトのポインタか隠しアイテムの情報。 */
  data: 0x08,
  /** 隠しアイテムの道具番号（u16）。 */
  hiddenItem: 0x08,
  /** 隠しアイテムのフラグ番号（u8）。 */
  hiddenFlag: 0x0a,
  /** 隠しアイテムの個数（下位 7 ビット）と足元フラグ（最上位ビット）。 */
  hiddenAmount: 0x0b,
} as const;

/** 看板の種別のうち、隠しアイテムを表すもの（AdvanceMap と同じく 5〜7）。 */
export const SIGN_HIDDEN_ITEM_KINDS: readonly number[] = [5, 6, 7];
