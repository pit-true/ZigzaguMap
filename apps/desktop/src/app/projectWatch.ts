import type { MapId } from "@zigzagumap/core";

/**
 * ファイルの変化の監視（Phase5 #404、Q15）の計算（DOM を使わない）。
 * 見るのは `maps\BB\MM.json`・`maps\BB\scripts_MM.json`・`maps\tilesets\` の下・`maps\project.json`・`maps\regionmap.json`・
 * `maps\trainers.json`・`maps\scripts.json`・`zigzagumap.json`。
 */

/** フォルダの直下にあれば見るファイル。 */
export const WATCHED_FILES: readonly string[] = [
  "zigzagumap.json",
  "maps/project.json",
  "maps/regionmap.json",
  "maps/trainers.json",
  "maps/scripts.json",
];

/** タイルセットの置き場所（下のフォルダも全部見る）。 */
export const WATCHED_TILESET_DIR = "maps/tilesets";

/** バンクのフォルダの名前（`maps\03`）。 */
export function isBankDir(name: string): boolean {
  return /^\d{1,3}$/.test(name);
}

/** バンクのフォルダの中で見るファイル（`00.json`・`scripts_00.json`）。 */
export function isWatchedMapFile(name: string): boolean {
  return /^(scripts_)?\d{1,3}\.json$/.test(name);
}

/** 見たときの印（更新日時と大きさ）。 */
export type FileStamps = ReadonlyMap<string, string>;

/** 外で変わったファイル。 */
export interface FileChanges {
  readonly changed: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** 前と今の印を比べる。 */
export function diffStamps(before: FileStamps, after: FileStamps): FileChanges {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [path, stamp] of after) {
    const old = before.get(path);
    if (old === undefined) added.push(path);
    else if (old !== stamp) changed.push(path);
  }
  for (const path of before.keys()) if (!after.has(path)) removed.push(path);
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

/** 変化が無いか。 */
export function noChanges(c: FileChanges): boolean {
  return c.changed.length === 0 && c.added.length === 0 && c.removed.length === 0;
}

/** 変わったファイルのうち、マップの JSON（`maps/BB/MM.json`・`scripts_MM.json`）のマップ。 */
export function changedMapsOf(c: FileChanges): MapId[] {
  const out = new Map<string, MapId>();
  for (const path of [...c.changed, ...c.added, ...c.removed]) {
    const m = /^maps\/(\d{1,3})\/(?:scripts_)?(\d{1,3})\.json$/.exec(path);
    if (m) out.set(`${Number(m[1])}.${Number(m[2])}`, { bank: Number(m[1]), map: Number(m[2]) });
  }
  return [...out.values()].sort((a, b) => a.bank - b.bank || a.map - b.map);
}
