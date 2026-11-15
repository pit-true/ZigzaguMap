import { formatHex } from "@zigzagumap/core";

/**
 * ブロックエディタに Phase5 で足した操作の文言（ZigzaguMap 独自。#393〜#397）。
 * AdvanceMap の Japanese.ini に無いので、ここに直接書く。
 */

const hex = (v: number, digits: number): string => formatHex(v, digits);

/** マス番号（0〜11）の場所の名前。 */
const CELL_NAMES = ["下層 左上", "下層 右上", "下層 左下", "下層 右下", "上層 左上", "上層 右上", "上層 左下", "上層 右下", "3層目 左上", "3層目 右上", "3層目 左下", "3層目 右下"];

function flipName(h: boolean, v: boolean): string {
  if (h && v) return "左右・上下";
  if (h) return "左右";
  if (v) return "上下";
  return "なし";
}

export const jaBlockTools = {
  // ---- #393 タイルの矩形・反転・パレットだけ・ホバー ----
  /** タイル一覧のホバー。 */
  hoverSheet: (tile: number, palette: number) => `タイル ${hex(tile, 3)}  パレット ${palette}（今のパレット）`,
  /** 8 マスのホバー。 */
  hoverCell: (cell: number, tile: number, palette: number, h: boolean, v: boolean) =>
    `${CELL_NAMES[cell] ?? ""}: タイル ${hex(tile, 3)}  パレット ${palette}  反転 ${flipName(h, v)}`,
  /** 選んでいる矩形の大きさ。 */
  selectionSize: (w: number, h: number) => `${w}×${h} のタイルを選んでいます`,
  pickedSize: (w: number, h: number) => `${w}×${h} のタイルを拾いました（反転とパレットもそのまま置きます）`,

  // ---- #394 コピー・貼り付け・入れ替え ----
  menuEdit: "編集",
  copy: "ブロックのコピー",
  cut: "ブロックの切り取り",
  paste: "ブロックの貼り付け",
  swap: "ブロックの入れ替え",
  copied: (block: number) => `ブロック ${hex(block, 3)} をコピーしました`,
  cutDone: (block: number) => `ブロック ${hex(block, 3)} を切り取りました（空のブロックにしました）`,
  pasted: (block: number) => `ブロック ${hex(block, 3)} に貼り付けました`,
  pasteTripleNoNext: "次のブロックが無いため、3 層のブロックは貼り付けられません。",
  pasteTripleNextIsTriple: (next: number) => `次のブロック ${hex(next, 3)} も 3 層なので、3 層のブロックは貼り付けられません。`,
  pasteTripleCleanup: (next: number) => `ブロック ${hex(next, 3)} は 3 層目に使われます。属性と上層を消します。`,
  swapStart: "入れ替え: 1 つ目のブロックを押してください（もう一度 X で終わる）",
  swapOff: "入れ替えを終えました",
  swapSecond: (block: number) => `入れ替え: 1 つ目はブロック ${hex(block, 3)}。2 つ目のブロックを押してください`,
  swapOtherTileset: "入れ替えられるのは、同じタイルセットの中のブロックどうしです。",
  swapTitle: "ブロックの入れ替え",
  swapConfirm: (a: number, b: number, maps: number, primary: boolean) =>
    [
      `ブロック ${hex(a, 3)} と ${hex(b, 3)} を入れ替えます。`,
      "",
      `このタイルセットを使うマップは ${maps} 枚です。マップに置いた番号も付け替えますか？（付け替えると、マップの見た目は変わりません）`,
      ...(primary ? ["主のタイルセットなので、付け替えたマップはどれも次の出力で maps\\ に書かれます。"] : []),
      "",
      "はい: 番号も付け替える　いいえ: タイルセットの中だけ入れ替える　キャンセル: やめる",
    ].join("\n"),
  swapped: (a: number, b: number, maps: number) => `ブロック ${hex(a, 3)} と ${hex(b, 3)} を入れ替えました（付け替えたマップ ${maps} 枚）`,
  /** 入れ替えられない理由（EditError の blockSwapRefused）。 */
  swapRefused: (reason: string) =>
    ({
      same: "同じブロックは入れ替えられません。",
      child: "3 層のブロックの 3 層目に使われているブロックは、単独では入れ替えられません。3 層のブロックを選んでください。",
      noNext: "表の最後の 3 層のブロックは、3 層目が無いため入れ替えられません。",
      mixed: "3 層のブロック（N と N+1 の組）は、ほかの 3 層のブロックとだけ入れ替えられます。",
      overlap: "3 層のブロックの組が重なるため、入れ替えられません。",
    })[reason] ?? "このブロックは入れ替えられません。",

  /** ショートカット一覧（ヘルプ）。 */
  shortcutRectKeys: "ドラッグ",
  shortcutRect: "タイルを矩形で選ぶ。8 マスの押した位置を左上にして置き、はみ出た分は置かない",
  shortcutRectWhere: "ブロックエディタのタイル一覧",
  shortcutPickKeys: "右ドラッグ",
  shortcutPick: "置いてあるタイルを反転とパレットごと矩形で拾う",
  shortcutPaletteKeys: "Ctrl＋左クリック",
  shortcutPalette: "タイルは変えずに、パレットだけを今のパレットにする",
  shortcutCellsWhere: "ブロックエディタの 8 マス・3層目の 4 マス",
  shortcutClipboard: "選んでいるブロックのコピー・切り取り・貼り付け（編集 メニュー）",
  shortcutSwap: "ブロックの入れ替えのオン・オフ（2 つのブロックを順に押す）",
  shortcutWindowWhere: "ブロックエディタ",
} as const;

/** ヘルプのショートカットの一覧に足す行（app/shortcutList.ts が並べる）。 */
export function blockToolShortcutRows(): { keys: string; action: string; where: string }[] {
  const t = jaBlockTools;
  return [
    { keys: t.shortcutRectKeys, action: t.shortcutRect, where: t.shortcutRectWhere },
    { keys: t.shortcutPickKeys, action: t.shortcutPick, where: t.shortcutCellsWhere },
    { keys: t.shortcutPaletteKeys, action: t.shortcutPalette, where: t.shortcutCellsWhere },
    { keys: "Ctrl+C、Ctrl+X、Ctrl+V", action: t.shortcutClipboard, where: t.shortcutWindowWhere },
    { keys: "X", action: t.shortcutSwap, where: t.shortcutWindowWhere },
  ];
}
