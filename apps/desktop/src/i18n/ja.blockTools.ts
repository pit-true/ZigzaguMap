import { formatHex } from "@zigzagumap/core";

/**
 * ブロックエディタに Phase5 で足した操作の文言（ZigzaguMap 独自。#393〜#397）。
 * AdvanceMap の Japanese.ini に無いので、ここに直接書く。
 */

const hex = (v: number, digits: number): string => formatHex(v, digits);

/** マス番号（0〜11）の場所の名前。 */
const CELL_NAMES = [
  "下のレイヤー 左上", "下のレイヤー 右上", "下のレイヤー 左下", "下のレイヤー 右下",
  "上のレイヤー 左上", "上のレイヤー 右上", "上のレイヤー 左下", "上のレイヤー 右下",
  "3枚目のレイヤー 左上", "3枚目のレイヤー 右上", "3枚目のレイヤー 左下", "3枚目のレイヤー 右下",
];

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

  /** ショートカット一覧（ヘルプ）。 */
  shortcutRectKeys: "ドラッグ",
  shortcutRect: "タイルを矩形で選ぶ。8 マスの押した位置を左上にして置き、はみ出た分は置かない",
  shortcutRectWhere: "ブロックエディタのタイル一覧",
  shortcutPickKeys: "右ドラッグ",
  shortcutPick: "置いてあるタイルを反転とパレットごと矩形で拾う",
  shortcutPaletteKeys: "Ctrl＋左クリック",
  shortcutPalette: "タイルは変えずに、パレットだけを今のパレットにする",
  shortcutCellsWhere: "ブロックエディタの 8 マス・3枚目のレイヤーの 4 マス",
} as const;

/** ヘルプのショートカットの一覧に足す行（app/shortcutList.ts が並べる）。 */
export function blockToolShortcutRows(): { keys: string; action: string; where: string }[] {
  const t = jaBlockTools;
  return [
    { keys: t.shortcutRectKeys, action: t.shortcutRect, where: t.shortcutRectWhere },
    { keys: t.shortcutPickKeys, action: t.shortcutPick, where: t.shortcutCellsWhere },
    { keys: t.shortcutPaletteKeys, action: t.shortcutPalette, where: t.shortcutCellsWhere },
  ];
}
