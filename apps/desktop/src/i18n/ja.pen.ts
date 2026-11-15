import { ini } from "./ini";

/** 描く道具（3 層のブロックの選び方と置けない規則、自動ペン、マップ作成補助）の文言（Phase4。ZigzaguMap 独自）。 */

function hex3(n: number): string {
  return n.toString(16).toUpperCase().padStart(3, "0");
}

export const jaPen = {
  /** ステータスバーのブロックの表示に足す（#300）。 */
  tripleSuffix: "　トリプルレイヤー",
  tripleUnresolvedSuffix: "　トリプルレイヤー（次のブロックが無い）",
  tripleChildSuffix: (parent: number) => `　トリプルレイヤー ${hex3(parent)} の3枚目のレイヤー（単独では置けない）`,
  /** 3 層の次の番号を書かなかったとき（#301）。 */
  tripleChildSkipped: (n: number) => `トリプルレイヤーの3枚目のレイヤーに使われているブロックは置けません（${n} マスを飛ばしました）`,
  /** 表示メニューの印（#301）。 */
  tripleChildMarks: "3枚目のレイヤーに使われているブロックに印を付ける",

  /** 自動ペン（#310）。マップタブの右の欄。 */
  autoPen: "自動ペン (P)",
  autoPenHint: "選んだブロックがパーツ（岸・木・道など）に入っていれば、周りに合わせて描く。入っていなければふつうの鉛筆。P で切り替え",
  autoPenSize: "筆",
  autoPenSizeHint: "筆の大きさ（マス）",
  autoPenMovement: "移動許可も付ける",
  autoPenMovementHint: "パーツのマスに決めた移動許可、無ければ全マップでそのブロックにいちばん多い移動許可を書く",
  autoPenOn: "自動ペン: オン",
  autoPenOff: "自動ペン: オフ",
  autoPenPlain: "自動ペン: このブロックはパーツに入っていないので、ふつうに描きます",
  autoPenPart: (name: string, kind: string) => `自動ペン: ${name}（${kind}）`,
  autoPenNoParts: "このタイルセットにはパーツがありません（ツール > マップ作成補助 で作れます）",
  autoPenAnalyzing: "このタイルセットにはパーツが無いので、マップから候補を作っています…",
  autoPenAnalyzed: (n: number) =>
    n === 0 ? "マップから候補を作れませんでした（ツール > マップ作成補助 で作れます）" : `マップから候補を ${n} 個作りました（自動ペンで使えます。残すときはツール > マップ作成補助 で保存）`,
  /** 表示メニュー。 */
  autoPenTint: "自動ペンで描けるブロックに色を付ける",
  /** ショートカット一覧。 */
  shortcutAutoPen: "自動ペンの切り替え",
  shortcutAutoPenWhere: "マップタブ",
  shortcutPalettePickKeys: "Ctrl＋右ドラッグ",
  shortcutPalettePick: "矩形を選ぶ（右端がトリプルレイヤーのブロックなら 1 マス広げ、入ったトリプルレイヤーの次の番号は書かないマスにする）",
  shortcutPalettePickWhere: "マップタブのブロックパレット",
  /** 種類と役割の名前。 */
  kinds: { fill: "面", edge: "縁つき", piece: "部品", repeat: "くり返し" } as Record<string, string>,
  roles: {
    ground: "地面",
    grass: ini.WildePokemon["10"],
    path: "道",
    water: "水",
    tree: "木",
    cliff: "崖",
    fence: "柵",
    building: "建物",
    decoration: "飾り",
    other: "その他",
  } as Record<string, string>,
};
