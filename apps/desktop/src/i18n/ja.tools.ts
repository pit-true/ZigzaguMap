/** 描く道具と表示の補助の文言（Phase5 列 1: #388〜#391。ZigzaguMap 独自）。 */

export const jaTools = {
  /** 道具の帯（#388）。ボタンは短く、題（マウスを乗せたときの説明）にキーと使い方を書く。 */
  pencil: "鉛筆",
  fill: "塗り",
  shift: "シフト",
  pencilHint: "鉛筆 (N): 今までと同じ描き方（Ctrl＋ドラッグで矩形塗り、Alt＋ドラッグで入れ替え、Shift を押しながらで直線）",
  fillHint: "塗りつぶし (B): 押したマスとつながった同じマスを塗る。Ctrl＋クリックでマップの中の同じマスを全部置き換える（マジック塗り）",
  shiftHint: "マップシフト (S): ドラッグした分だけマップ全体のブロックと移動許可をずらす（はみ出た分は反対側に出る）",
  stripLabel: "道具",
  toolNames: { pencil: "鉛筆", fill: "塗りつぶし", shift: "マップシフト" } as Record<string, string>,
  toolChanged: (name: string) => `道具: ${name}`,
  /** 塗りつぶしとマジック塗り。 */
  filled: (n: number) => `塗りつぶし: ${n} マス`,
  magicFilled: (n: number) => `マジック塗り: ${n} マス`,
  fillNothing: "塗るマスがありません",
  /** スマートパス（#389）。 */
  smartPath: "スマートパス",
  smartPathHint: "選択がちょうど 3×3 のとき、それを道や池の縁の見本にして、周りに合わせて角・辺・中を選んで描く（鉛筆と塗りつぶし）",
  smartPathNeeds3x3: "スマートパスは、選択がちょうど 3×3 のときだけ使えます",
  smartPathOn: "スマートパス: オン",
  smartPathOff: "スマートパス: オフ",
  /** マップシフト（#390）。 */
  shifting: (dx: number, dy: number) => `マップシフト: 横 ${signed(dx)}、縦 ${signed(dy)}（離すとずらす。Esc でやめる）`,
  shifted: (dx: number, dy: number) => `マップシフト: 横 ${signed(dx)}、縦 ${signed(dy)} ずらしました`,
  /** 対話式リサイズの窓（#390）。 */
  resizeTitle: "マップの大きさと位置",
  resizeOpen: "大きさと位置を変える…",
  resizeOpenHint: "幅・高さと、新しい枠の中で今のマップを置く位置を決めて、広げる・縮める（イベントと接続も一緒にずれる）",
  resizeWidth: "幅",
  resizeHeight: "高さ",
  resizeLeft: "左に足す",
  resizeTop: "上に足す",
  resizePlaceNote: "下の図のマップをドラッグして、新しい枠の中の位置を決めます（負の値はその分を削ります）",
  resizeFill: "広げた所",
  resizeFillEdge: "端の写し（今と同じ）",
  resizeFillBorder: "境界ブロック",
  resizeFillSelection: "選んでいるブロック",
  resizeNow: (w: number, h: number) => `今の大きさ: ${w}×${h}`,
  resizeLimit: (w: number, max: number) => `幅 ${w} のときの高さの上限: ${max}`,
  resizeTooSmall: (min: number) => `幅と高さは ${min} 以上にしてください`,
  resizeTooLarge: (w: number, max: number) => `大きすぎます（幅 ${w} のときの高さの上限は ${max}）`,
  resizeSummary: (l: number, r: number, u: number, d: number) => `左 ${signed(l)}、右 ${signed(r)}、上 ${signed(u)}、下 ${signed(d)}`,
  /** ショートカット一覧。 */
  shortcutPencil: "道具を鉛筆にする",
  shortcutFill: "道具を塗りつぶしにする",
  shortcutShift: "道具をマップシフトにする",
  shortcutToolWhere: "マップタブ・移動エリアタブ",
  shortcutMagicKeys: "Ctrl＋クリック",
  shortcutMagic: "マジック塗り（マップの中の同じマスを全部置き換える）",
  shortcutMagicWhere: "塗りつぶしの道具のとき",
  shortcutLineKeys: "Shift＋左ドラッグ",
  shortcutLine: "直線（描き始めの向きで横か縦に固定して描く。マップシフトでは横か縦だけずらす）",
  shortcutShiftCancel: "マップシフトのドラッグをやめる",
  shortcutShiftCancelWhere: "マップシフトの道具でドラッグしている間",
};

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
