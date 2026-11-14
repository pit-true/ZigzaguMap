import { formatHex } from "../binary/bytes.js";
import type { MapId } from "../map/types.js";
import type { ProjectFs } from "./ProjectFs.js";

/*
 * maps\ の中のパスと、フォルダの中の一覧の取り方はここに集める（出力の形式が変わったとき、ここと各 *Json.ts を直せばよい）。
 * 中身の形式（JSON の読み書き）は project/*Json.ts、読み書きの順番と時機は各クラス（CfruProject・AutoPenLibrary・StampLibrary など）。
 */

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
/** タウンマップ（maps/regionmap.json）のパス。 */
export const REGION_MAP_PATH = `${MAPS_DIR}/regionmap.json`;
/** スタンプのフォルダ（maps/stamps。1 つのスタンプが 1 ファイル）。 */
export const STAMPS_DIR = `${MAPS_DIR}/stamps`;
/** 自動ペンのパーツの定義のフォルダ（maps/autopen。タイルセット 1 つが 1 ファイル。Phase4 #303）。 */
export const AUTOPEN_DIR = `${MAPS_DIR}/autopen`;
/** ZigzaguMap で足した・変えたトレーナー（maps/trainers.json。Phase3 #245）。 */
export const TRAINERS_JSON_PATH = `${MAPS_DIR}/trainers.json`;
/** ROM のスクリプトを埋める範囲（maps/rom_erase.json。Phase2 #220）。 */
export const ROM_ERASE_PATH = `${MAPS_DIR}/rom_erase.json`;
/** バンクと .s の対応表（maps/scripts.json。Phase2）。 */
export const SCRIPTS_JSON_PATH = `${MAPS_DIR}/scripts.json`;

/** マップ 1 枚のラベルのファイルのパス（maps/BB/scripts_MM.json。Phase2）。 */
export function mapLabelsFilePath(bank: number, map: number): string {
  return `${MAPS_DIR}/${pad2(bank)}/scripts_${pad2(map)}.json`;
}

/** マップの JSON のパス（maps/BB/MM.json。2 桁にそろえる）。 */
export function mapSourcePath(id: MapId): string {
  return `${MAPS_DIR}/${pad2(id.bank)}/${pad2(id.map)}.json`;
}

/**
 * タイルセットの識別子（`primary_298B44` の形。番号はヘッダーの位置の 16 進 6 桁）。maps/tilesets のフォルダ名と、
 * 自動ペンのパーツのファイル名（maps/autopen/<識別子>.json）に使う。
 */
export function tilesetFileBase(headerAddress: number, secondary: boolean): string {
  return `${secondary ? "secondary" : "primary"}_${formatHex(headerAddress >>> 0, 6)}`;
}

/** タイルセットのフォルダ（maps/tilesets/primary_XXXXXX など）。 */
export function tilesetFolder(headerAddress: number, secondary: boolean): string {
  return `${TILESETS_DIR}/${tilesetFileBase(headerAddress, secondary)}`;
}

/** タイルセットのフォルダの情報ファイル（tileset.json）のパス。 */
export function tilesetInfoPath(folder: string): string {
  return `${folder}/${TILESET_INFO_FILE}`;
}

/** タイルセットのフォルダの画像ファイル（tiles.png）のパス。 */
export function tilesetImagePath(folder: string): string {
  return `${folder}/${TILESET_IMAGE_FILE}`;
}

/** maps/tilesets の中のフォルダ（パス）。 */
export async function listTilesetFolders(fs: ProjectFs): Promise<string[]> {
  return (await fs.list(TILESETS_DIR)).map((name) => `${TILESETS_DIR}/${name}`);
}

/** フォルダの中の `*.json`（パスと、拡張子を除いた名前）。フォルダが無ければ空。 */
export async function listJsonFiles(fs: ProjectFs, dir: string): Promise<{ readonly path: string; readonly base: string }[]> {
  if (!(await fs.exists(dir))) return [];
  const out: { path: string; base: string }[] = [];
  for (const name of await fs.list(dir)) {
    const m = /^(.*)\.json$/i.exec(name);
    if (m) out.push({ path: `${dir}/${name}`, base: m[1]! });
  }
  return out;
}

/** maps/BB/ の中のファイル（バンクのフォルダは数字の名前だけ。`bank` はフォルダ名、`name` はファイル名）。 */
export async function listBankFiles(fs: ProjectFs): Promise<{ readonly bank: string; readonly name: string; readonly path: string }[]> {
  const out: { bank: string; name: string; path: string }[] = [];
  for (const bank of await fs.list(MAPS_DIR)) {
    if (!isNumericName(bank)) continue;
    for (const name of await fs.list(`${MAPS_DIR}/${bank}`)) out.push({ bank, name, path: `${MAPS_DIR}/${bank}/${name}` });
  }
  return out;
}

/** 数字だけの名前か（バンク・マップのフォルダとファイルの判定用）。 */
export function isNumericName(name: string): boolean {
  return /^[0-9]+$/.test(name);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
