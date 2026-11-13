/** 野生ポケモンの構造体の大きさとフィールドの位置。 */

/** 野生ヘッダー（バンク、マップ、4 エリアのポインタ）のバイト数。 */
export const WILD_HEADER_SIZE = 20;
/** エリア情報（出現率とスロットへのポインタ）のバイト数。 */
export const WILD_INFO_SIZE = 8;
/** スロット 1 個（最低 Lv、最高 Lv、種族）のバイト数。 */
export const WILD_SLOT_SIZE = 4;
/** 野生ヘッダー表の件数の上限（Bochi と同じ）。 */
export const MAX_WILD_HEADERS = 512;
/** 表の終端を表すバンク・マップ番号。 */
export const WILD_TABLE_END = 0xff;

/** エリアの番号。 */
export const WildAreaKind = {
  Land: 0,
  Water: 1,
  RockSmash: 2,
  Fishing: 3,
} as const;

/** エリアの数。 */
export const WILD_AREA_COUNT = 4;
/** エリアごとのスロット数（陸・水・岩砕き・釣り）。 */
export const WILD_SLOT_COUNTS: readonly number[] = [12, 5, 5, 10];

/** 時間帯（maps\ の Wild[].Time）。素の ROM は昼だけ。 */
export const WildTime = {
  Morning: 0,
  Day: 1,
  Evening: 2,
  Night: 3,
} as const;

/** 野生ヘッダーのフィールド位置。 */
export const WILD_HEADER = {
  bank: 0x00,
  map: 0x01,
  padding: 0x02,
  /** エリアのポインタの先頭（4 バイトずつ 4 個）。 */
  areas: 0x04,
} as const;

/** エリア情報のフィールド位置。 */
export const WILD_INFO = {
  rate: 0x00,
  padding1: 0x01,
  padding2: 0x02,
  slots: 0x04,
} as const;

/** スロットのフィールド位置。 */
export const WILD_SLOT = {
  minLevel: 0x00,
  maxLevel: 0x01,
  species: 0x02,
} as const;
