/** イベントの種類ごとの表示・イベントの濃さ・右クリックの「ここに○○を追加」（#304）の文言（ZigzaguMap 独自）。 */
export const jaEventView = {
  /** 表示メニューのサブメニュー。 */
  menu: "イベントの種類",
  /** 種類ごとの項目（チェックが付いているものを描く）。 */
  kinds: {
    person: "人を表示",
    sign: "看板を表示",
    trap: "スクリプトタイルを表示",
    warp: "ワープを表示",
  } as Readonly<Record<string, string>>,
  /** 濃さの窓の 2 段目。 */
  opacityLabel: "イベントの濃さ",
  movementLabel: "移動エリア",
  /** 右クリックのメニュー。 */
  add: {
    person: "ここに人を追加",
    sign: "ここに看板を追加",
    trap: "ここにスクリプトタイルを追加",
    warp: "ここにワープを追加",
    itemBall: "ここに落とし物を追加",
  } as Readonly<Record<string, string>>,
  added: (what: string, index: number, x: number, y: number) => `${what} ${index} を (${x}, ${y}) に追加しました`,
  /** 落とし物の見た目を調べている間。 */
  scanning: "落とし物の見た目を調べています…",
};
