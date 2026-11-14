/** 接続の境目の警告（#305）と一覧の特別な絞り込みの文言（ZigzaguMap 独自）。 */
export const jaSeams = {
  /** ステータスバーの注意（押すと一覧）。 */
  status: (connections: number) => `注意: 接続 ${connections} か所`,
  statusHint: "接続先のタイルセットの組が違い、境目で絵が変わるマスがあります。押すと一覧を出します",
  title: "接続の境目の注意",
  intro:
    "ゲームでは、接続先のマップの見えている部分も今のマップのタイルセットで描きます。次の接続では、境目から見える範囲（横 8・縦 6 マス）に、こちらの組では違う絵になるマスがあります（マップタブの隣の帯に赤い枠で示します）。",
  row: (side: string, bank: number, map: number, name: string | null, cells: number) => `・${side}: ${bank}.${map}${name ? ` ${name}` : ""}（${cells} マス）`,
  sides: { up: "上", down: "下", left: "左", right: "右" } as Readonly<Record<string, string>>,
  /** 一覧の絞り込みの書式の説明（入力欄の吹き出し）。 */
  filterHint: "名前か番号で絞り込みます。「場所:58,7E」で地名の番号（16 進）、「地形:9」で配置の番号（16 進）のマップだけを出します。並べて使えます",
};
