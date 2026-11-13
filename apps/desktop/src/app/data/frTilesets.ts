// AdvanceMap 1.92 の Ini\frTilesets.ini の [Sortierung]（タイルセットのグループ）。
// 「タイルセットのグループで並び替え」と「マップとタイルセットで並び替え」の補足に使う。

/**
 * グループ名と、そのグループに入るタイルセットの番号。番号が複数のグループにあるときは先に書いたグループ（26 はジム）。
 */
export const FR_TILESET_GROUPS: readonly (readonly [string, readonly number[]])[] = [
  ["NormaleMaps", [0]],
  ["ジム", [22, 23, 26, 27, 28, 29, 30, 31]],
  ["ポケセン", [14]],
  ["ショップ", [13, 41]],
  ["船着き場", [65]],
  ["建物/施設", [12, 17, 18, 19, 20, 21, 25, 26, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 60, 64, 66, 67]],
];

/** 補足を付けないグループ（通常のマップ）。 */
export const FR_TILESET_PLAIN_GROUP = "NormaleMaps";

/** タイルセットの番号が入っているグループ名。どこにも入らなければ null。 */
function groupOfNumber(n: number): string | null {
  return FR_TILESET_GROUPS.find(([, numbers]) => numbers.includes(n))?.[0] ?? null;
}

/**
 * 「タイルセットのグループで並び替え」のグループ。AdvanceMap と同じく、タイルセット 2 の番号で引き、
 * 無ければタイルセット 1 の番号で引く（例: 1・2 が 0・65 の船着き場、12・44 の 30.0 は建物/施設）。
 */
export function tilesetGroupOf(primary: number, secondary: number): string | null {
  return groupOfNumber(secondary) ?? groupOfNumber(primary);
}

/**
 * 「マップとタイルセットで並び替え」の補足。AdvanceMap と同じく、タイルセット 2 の番号だけで引く
 * （30.0 のようにタイルセット 1 だけが建物/施設のマップは補足なし）。通常のマップは空。
 */
export function tilesetSuffixOf(secondary: number): string {
  const g = groupOfNumber(secondary);
  return g === null || g === FR_TILESET_PLAIN_GROUP ? "" : g;
}
