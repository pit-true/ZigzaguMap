import { formatHex } from "@zigzagumap/core";
import { ini } from "./ini";

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
  pasteTripleNoNext: "次のブロックが無いため、トリプルレイヤーのブロックは貼り付けられません。",
  pasteTripleNextIsTriple: (next: number) => `次のブロック ${hex(next, 3)} もトリプルレイヤーなので、トリプルレイヤーのブロックは貼り付けられません。`,
  pasteTripleCleanup: (next: number) => `ブロック ${hex(next, 3)} は 3枚目のレイヤーに使われます。属性と上のレイヤーを消します。`,
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
      child: "トリプルレイヤーの 3枚目のレイヤーに使われているブロックは、単独では入れ替えられません。トリプルレイヤーのブロックを選んでください。",
      noNext: "表の最後のトリプルレイヤーのブロックは、3枚目のレイヤーが無いため入れ替えられません。",
      mixed: "トリプルレイヤーのブロック（N と N+1 の組）は、ほかのトリプルレイヤーのブロックとだけ入れ替えられます。",
      overlap: "トリプルレイヤーのブロックの組が重なるため、入れ替えられません。",
    })[reason] ?? "このブロックは入れ替えられません。",

  // ---- #395 使用回数・未使用・画像の書き出し ----
  menuView: "表示",
  viewUsage: "使用回数",
  viewUnusedBlocks: "未使用のブロック",
  viewUnusedTiles: "未使用のタイル",
  counting: "使用回数を数えています…",
  counted: (unusedBlocks: number, unusedTiles: number | null, ms: number) =>
    `使用回数を数えました（未使用のブロック ${unusedBlocks} 個${unusedTiles === null ? "" : `、未使用のタイル ${unusedTiles} 枚`}、${ms}ms）`,
  exportMenu: "ブロック一覧の画像の書き出し…",
  exportTitle: "ブロック一覧の画像の書き出し",
  exportTileset: "タイルセット",
  exportTileset1: ini.BlockEditorForm["131"],
  exportTileset2: ini.BlockEditorForm["132"],
  exportRange: "範囲（16 進）",
  exportLayers: "レイヤー",
  exportLower: "下",
  exportUpper: "上",
  exportThird: "3枚目",
  exportColumns: "幅（ブロック数）",
  exportBackground: "透明の扱い",
  exportBgTransparent: "そのまま（透明）",
  exportBgBlack: "黒",
  exportBgPalette0: "パレット0の色0",
  exportInfo: (blocks: number, w: number, h: number) => `${blocks} 個のブロック、${w}×${h} 画素`,
  exportSave: "書き出す…",
  exportFailed: "PNG を作れませんでした。",
  exported: (path: string) => `書き出しました: ${path}`,

  // ---- #397 新しいタイルセット ----
  newTilesetMenu: "新しいタイルセット…",
  newTilesetTitle: "新しいタイルセット",
  newTilesetKind: "種類",
  newTilesetCount: "タイル数",
  newTilesetBlocks: "ブロック数",
  newTilesetContent: "初めの中身",
  newTilesetEmpty: "空",
  newTilesetCopy: "今のタイルセットの写し",
  newTilesetLimit: (tiles: number, blocks: number) => `上限はタイル ${tiles}（16 の倍数に切り上げ）、ブロック ${blocks} です。`,
  newTilesetNote: "作ると、表示中のマップの組をこのタイルセットに付け替えます（1 回の Ctrl+Z で戻ります）。出力すると maps\\tilesets に New のタイルセットとして書きます。",
  newTilesetCreate: "作る",
  newTilesetNumber: (field: string, text: string) => `${field}の「${text}」は数ではありません。`,
  newTilesetDone: (pointer: number, tiles: number, blocks: number) =>
    `新しいタイルセット ${hex(pointer >>> 0, 8)}（タイル ${tiles}、ブロック ${blocks}）を作り、表示中のマップに付け替えました`,

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
  shortcutWindowWhere: "ブロックエディタの窓",
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
