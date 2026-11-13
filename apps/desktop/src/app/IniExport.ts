import { buildMapTree, SORT_BY_NAME_AND_TILESET } from "./MapTreeModel";
import type { MapCatalog } from "./MapCatalog";
import { encodeShiftJis } from "./shiftJis";

/** 書き出すファイル（AdvanceMap と同じ名前）。 */
export const NEW_MAIN_INI = "NewMain.ini";
export const NEW_MAPS_INI = "NewMaps.ini";

/**
 * 設定 > マップの表示設定 > ヘッダーから新たなIniファイルを作る。AdvanceMap と同じ形の 2 つの ini を作る。
 * - NewMain.ini: マップ名ごとの節に「番号=バンク.マップ」を並べる（「マップとタイルセットで並び替え」の順。マップの無い名前は出さない）
 * - NewMaps.ini: 「[バンク.マップ]」の節に「Name=マップ名 補足」
 * 文字コードは Shift_JIS、改行は CRLF。
 *
 * AdvanceMap は Delphi の TIniFile で書くので、同じ名前の地名（ちかつうろ、トレーナータワー など）の節は
 * 先に出た節にまとめられ、同じ番号のキーは後のグループの値で上書きされる。ここでも同じ結果になるように書く。
 */
export function buildNewIni(catalog: MapCatalog): { main: Uint8Array; maps: Uint8Array } {
  const header = buildMapTree(catalog, SORT_BY_NAME_AND_TILESET, "header")[0]!;
  const main = new IniWriter();
  const maps = new IniWriter();
  for (const group of header.children ?? []) {
    const children = (group.children ?? []).filter((c) => c.mapId);
    if (children.length === 0) continue;
    children.forEach((c, i) => {
      const id = `${c.mapId!.bank}.${c.mapId!.map}`;
      main.write(group.label, String(i), id);
      maps.write(id, "Name", c.label.replace(/ \(\d+\.\d+\)$/, ""));
    });
  }
  return { main: encodeShiftJis(main.text()), maps: encodeShiftJis(maps.text()) };
}

/** TIniFile.WriteString と同じ規則で節とキーを並べる（同じ節・キーは最初の位置のまま値を上書き）。 */
class IniWriter {
  private readonly sections = new Map<string, Map<string, string>>();

  write(section: string, key: string, value: string): void {
    let keys = this.sections.get(section);
    if (!keys) this.sections.set(section, (keys = new Map()));
    keys.set(key, value);
  }

  text(): string {
    const out: string[] = [];
    for (const [section, keys] of this.sections) {
      out.push(`[${section}]`);
      for (const [key, value] of keys) out.push(`${key}=${value}`);
    }
    return lines(out);
  }
}

/** 1 行ずつ CRLF を付ける（名前の空白と中黒は、一覧の項目を作るときに AdvanceMap と同じ半角にしてある）。 */
function lines(list: readonly string[]): string {
  return list.map((l) => `${l}\r\n`).join("");
}
