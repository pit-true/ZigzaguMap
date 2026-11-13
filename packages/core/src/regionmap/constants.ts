/** タウンマップの定数（FR/LG。ソース townmap2.h の値）。 */

/** 地名の表の横のマス数（MAP_MX_MAX + 1）。 */
export const REGION_MAP_WIDTH = 22;
/** 地名の表の縦のマス数（MAP_MY_MAX + 1）。 */
export const REGION_MAP_HEIGHT = 15;
/** 地名の表 1 枚のバイト数。 */
export const REGION_MAP_CELLS = REGION_MAP_WIDTH * REGION_MAP_HEIGHT;
/** マス 1 つの画面上の大きさ（ピクセル）。 */
export const REGION_MAP_CELL_PIXELS = 8;
/** 画面上で地名の表のマス (0, 0) が描かれる位置（CURSOR_XPOS / CURSOR_YPOS からカーソルの半分を引いた値）。 */
export const REGION_MAP_ORIGIN_X = 32;
export const REGION_MAP_ORIGIN_Y = 32;

/** 最初の地名番号（MAPPOS_START。マサラタウン）。 */
export const MAPSEC_FIRST = 0x58;
/** 「未設定/非表示」の地名番号（END）。 */
export const MAPSEC_NONE = 0xc5;
/** 位置・大きさ・人IDを持つ地名の数（0x58〜0xC5）。 */
export const MAPSEC_COUNT = MAPSEC_NONE - MAPSEC_FIRST + 1;
/** 名前を持つ地名の数（0x58〜0xC4）。 */
export const MAPSEC_NAMED_COUNT = MAPSEC_COUNT - 1;
/** 空を飛ぶの行き先を持つ地名の数（0x58〜0xC3。表の後ろが 4 バイト境界で別のデータになる）。 */
export const FLY_DESTINATION_COUNT = 108;
/** 飛び先（回復地点）の数（番号 1〜20。GetWarpPosByNo の上限）。 */
export const HEAL_LOCATION_COUNT = 20;
/** 飛び先 1 件のバイト数。 */
export const HEAL_LOCATION_SIZE = 8;
/** 人ID（訪問フラグ）が無いことを表す値（AdvanceMap の表示と同じ）。 */
export const NO_FLAG = 0xffff;

/** タウンマップの面（タウンマップNo 1〜4）。 */
export const REGION_MAP_PAGES = ["kanto", "sevii123", "sevii45", "sevii67"] as const;
export type RegionMapPage = (typeof REGION_MAP_PAGES)[number];
/** 地名の表のレイヤー（0: 街・道路 = 基本レイヤー、1: 洞窟 = トップレイヤー）。 */
export const REGION_MAP_LAYERS = ["map", "dungeon"] as const;
export type RegionMapLayer = (typeof REGION_MAP_LAYERS)[number];

/** 地図の画面の大きさ（タイル）。 */
export const REGION_SCREEN_TILES_X = 30;
export const REGION_SCREEN_TILES_Y = 20;
/** 地図の画像の大きさ（ピクセル）。 */
export const REGION_IMAGE_WIDTH = REGION_SCREEN_TILES_X * 8;
export const REGION_IMAGE_HEIGHT = REGION_SCREEN_TILES_Y * 8;
/** パレットの色数（PA_BG0〜4 の 5 本）。 */
export const REGION_PALETTE_COLORS = 80;

/** 地名番号が位置・大きさの表の範囲か。 */
export function isRegionSection(id: number): boolean {
  return Number.isInteger(id) && id >= MAPSEC_FIRST && id <= MAPSEC_NONE;
}

/** 地名番号が空を飛ぶの行き先の表の範囲か。 */
export function hasFlyDestination(id: number): boolean {
  return Number.isInteger(id) && id >= MAPSEC_FIRST && id < MAPSEC_FIRST + FLY_DESTINATION_COUNT;
}
