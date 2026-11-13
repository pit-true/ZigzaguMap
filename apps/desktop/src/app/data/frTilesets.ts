// AdvanceMap 1.92 の Ini\frTilesets.ini の [Sortierung]（タイルセットのグループ）。
// 「タイルセットのグループで並び替え」と「マップとタイルセットで並び替え」の補足に使う。

/**
 * グループ名と、そのグループに入るタイルセットの番号。タイルセット 1・2 のどちらかが入っていればそのグループ。
 * 先に書いたグループを優先する（例: 1・2 が 12・23 のジムは、建物/施設より先にジムに入る）。
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

/** タイルセット 1・2 の番号からグループ名を引く。どこにも入らなければ null。 */
export function tilesetGroupOf(primary: number, secondary: number): string | null {
  for (const [name, numbers] of FR_TILESET_GROUPS) {
    if (numbers.includes(primary) || numbers.includes(secondary)) return name;
  }
  return null;
}
