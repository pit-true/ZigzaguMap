/** FR の主タイルセットのタイル数（8×8）。これ以降の番号は副タイルセット。 */
export const PRIMARY_TILE_COUNT = 640;
/** FR の VRAM 上のタイル総数。 */
export const TOTAL_TILE_COUNT = 1024;
/** FR の主タイルセットのブロック数。これ以降の番号は副タイルセット。 */
export const PRIMARY_BLOCK_COUNT = 640;
/** FR のブロック総数。 */
export const TOTAL_BLOCK_COUNT = 1024;
/** 主タイルセットが使うパレット数（0〜6）。 */
export const PRIMARY_PALETTE_COUNT = 7;
/** マップで使うパレット数（主 7 + 副 6）。 */
export const TOTAL_PALETTE_COUNT = 13;
/** 4bpp タイル 1 枚のバイト数。 */
export const TILE_BYTES = 32;

/** マップヘッダーのバイト数。 */
export const MAP_HEADER_SIZE = 28;
/** フッター（レイアウト）のバイト数。 */
export const MAP_LAYOUT_SIZE = 28;
/** タイルセットヘッダーのバイト数。 */
export const TILESET_HEADER_SIZE = 24;
/** ブロック定義 1 個のバイト数（タイル指定 8 個）。 */
export const BLOCK_DEFINITION_SIZE = 16;
/** ブロック属性 1 個のバイト数。 */
export const BLOCK_ATTRIBUTE_SIZE = 4;

/** マップのマス（u16）のうちブロック番号の部分。 */
export const BLOCK_ID_MASK = 0x03ff;
/** マップのマス（u16）のうち移動許可（衝突 2 ビット + 高さ 4 ビット）の部分。 */
export const MOVEMENT_MASK = 0xfc00;
/** 移動許可の位置。 */
export const MOVEMENT_SHIFT = 10;
/** 移動許可の最大値（6 ビット）。 */
export const MOVEMENT_MAX = 0x3f;
