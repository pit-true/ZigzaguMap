import { formatHex } from "../binary/bytes.js";
import type { MapId } from "../map/types.js";

/** maps\ のフォルダ名。 */
export const MAPS_DIR = "maps";
/** maps\project.json のパス。 */
export const PROJECT_MANIFEST_PATH = `${MAPS_DIR}/project.json`;
/** プロジェクトの文字コード表（無ければ同梱の ND の表を使う）。 */
export const CHARMAP_PATH = "charmap.tbl";
/** 落とし物のスクリプトを書くファイル。 */
export const HIDDEN_ITEM_PATH = "assembly/overworld_scripts/HiddenItem.s";
/** タイルセットのフォルダ。 */
export const TILESETS_DIR = `${MAPS_DIR}/tilesets`;
/** タイルセットの情報ファイル名。 */
export const TILESET_INFO_FILE = "tileset.json";
/** タイルセットの画像ファイル名。 */
export const TILESET_IMAGE_FILE = "tiles.png";
/** タウンマップ（mapsegionmap.json）のパス。 */
export const REGION_MAP_PATH = `${MAPS_DIR}/regionmap.json`;

/** マップの JSON のパス（maps/BB/MM.json。2 桁にそろえる）。 */
export function mapSourcePath(id: MapId): string {
  return `${MAPS_DIR}/${pad2(id.bank)}/${pad2(id.map)}.json`;
}

/** タイルセットのフォルダ（maps/tilesets/primary_XXXXXX など。番号はヘッダーの位置の 16 進 6 桁）。 */
export function tilesetFolder(headerAddress: number, secondary: boolean): string {
  return `${TILESETS_DIR}/${secondary ? "secondary" : "primary"}_${formatHex(headerAddress, 6)}`;
}

/** 数字だけの名前か（バンク・マップのフォルダとファイルの判定用）。 */
export function isNumericName(name: string): boolean {
  return /^[0-9]+$/.test(name);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
