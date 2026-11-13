/** ブロック定義（タイル指定 8 個）と属性（4 バイト）の値の組み立てと分解。 */

/** ブロック 1 個のタイル指定の数（下層 4 + 上層 4）。 */
export const BLOCK_TILE_COUNT = 8;

/** タイル指定 1 個（u16）の中身。 */
export interface TileRef {
  /** タイル番号（0〜0x3FF。0x280 以降は副タイルセット）。 */
  tile: number;
  /** 左右反転。 */
  hflip: boolean;
  /** 上下反転。 */
  vflip: boolean;
  /** パレット番号（0〜15）。 */
  palette: number;
}

/** タイル指定（u16）を分解する。 */
export function unpackTileRef(value: number): TileRef {
  return { tile: value & 0x3ff, hflip: (value & 0x400) !== 0, vflip: (value & 0x800) !== 0, palette: (value >> 12) & 0xf };
}

/** タイル指定（u16）を組み立てる。 */
export function packTileRef(ref: TileRef): number {
  return (ref.tile & 0x3ff) | (ref.hflip ? 0x400 : 0) | (ref.vflip ? 0x800 : 0) | ((ref.palette & 0xf) << 12);
}

/** FR のブロック属性（u32）の中身。 */
export interface BlockAttributeFields {
  /** 挙動（ビット 0〜8。AdvanceMap の「マップアクション」は下位 8 ビット）。 */
  behavior: number;
  /** 地形（ビット 9〜13）。 */
  terrain: number;
  /** 野生の出る種類（ビット 24〜26。0: 無し、1: 草むら、2: 水上）。 */
  encounterType: number;
  /** 重なり（ビット 29〜30。0: 通常、1: 上層を主人公より下、2: 分割）。 */
  layerType: number;
}

/** 属性（u32）を FR の項目に分解する。 */
export function unpackBlockAttribute(value: number): BlockAttributeFields {
  return {
    behavior: value & 0x1ff,
    terrain: (value >>> 9) & 0x1f,
    encounterType: (value >>> 24) & 0x7,
    layerType: (value >>> 29) & 0x3,
  };
}

/** 属性（u32）の 4 バイト（AdvanceMap の右の 4 欄。0・1 がマップアクション、2・3 が背景）。 */
export function attributeBytes(value: number): [number, number, number, number] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** 4 バイトから属性（u32）を作る。 */
export function attributeFromBytes(bytes: readonly [number, number, number, number]): number {
  return ((bytes[0] & 0xff) | ((bytes[1] & 0xff) << 8) | ((bytes[2] & 0xff) << 16) | ((bytes[3] & 0xff) << 24)) >>> 0;
}

/** BGR555 の色を 8 ビットの RGB にする（AdvanceMap・Bochi と同じく 5 ビットを 8 倍）。 */
export function bgr555ToRgb(value: number): [number, number, number] {
  return [(value & 0x1f) * 8, ((value >> 5) & 0x1f) * 8, ((value >> 10) & 0x1f) * 8];
}

/** 8 ビットの RGB を BGR555 にする（下位 3 ビットは捨てる）。 */
export function rgbToBgr555(r: number, g: number, b: number): number {
  return ((r >> 3) & 0x1f) | (((g >> 3) & 0x1f) << 5) | (((b >> 3) & 0x1f) << 10);
}
