// ブロックエディタ・パレットエディタ・ブロックパレット一括変更の文言。
// 改訂版 Japanese.ini（[BlockEditorForm]・[PalettenForm]・[BlockDatenAnpassenForm]・
// [Verhalten_FRLG]・[Hintergrund_FRLG]）の値を使う。
import { fmt, hexRecord, ini } from "./ini";

const B = ini.BlockEditorForm;

const hex = (n: number, digits: number): string => n.toString(16).toUpperCase().padStart(digits, "0");

/** 00〜FF の 256 件（名前の無い値は 16 進 2 桁だけ）。 */
function comboItems(names: Readonly<Record<number, string>>): string[] {
  return Array.from({ length: 256 }, (_, i) => names[i] ?? hex(i, 2));
}

export const jaBlockEditor = {
  // [BlockEditorForm]
  title: B["130"],
  /** 題名（AdvanceMap と同じ空白の入れ方）。 */
  windowTitle: (primary: number | null, secondary: number | null) =>
    `${B["130"]}     ${B["131"]}: ${primary ?? "-"}  ${B["132"]}: ${secondary ?? "-"}`,
  lowerUpper: B["1300"],
  tile: B["1301"],
  block: B["1302"],
  offset: B["1303"],
  xflip: B["1304"],
  yflip: B["1305"],
  save: B["1306"],
  actionData: B["13070"],
  actionHint: B["13071"],
  actionPair: B["13072"],
  backgroundPair: B["13073"],
  paletteName: (n: number) => `Palette${n}`,

  menuTiles: B["13080"],
  saveTileset1: B["13081"],
  openTileset1: B["13082"],
  saveTileset2: B["13083"],
  openTileset2: B["13084"],
  reloadBlocks: B["13085"],
  menuBlocks: B["13090"],
  blockAmount: B["13095"],
  menuPalette: B["130100"],
  showPaletteEditor: B["130101"],
  /** AdvanceMap は「パレットの変更をROMに上書きする」。ZigzaguMap は ROM へ書かず、編集中の状態へ反映する。 */
  commitPalette: "パレットの変更を反映する",
  savePaletteFile: B["130103"],
  openPaletteFile: B["130104"],
  remapPalettes: B["130105"],

  duplicateColors: B["130810"],
  paletteFileMissing: B["130820"],
  tilesetImage: B["130821"],
  tilesetImageCanceled: B["130822"],
  blockSaveCanceled: B["130910"],
  bvdLoadCanceled: B["130920"],
  blockData: B["130921"],
  blockAmountPrompt: (max: number) => fmt(B["130950"], max),
  blockAmountCanceled: B["130952"],

  dibFilter: "Device Intependent Bitmap (*.dib)",
  bmpFilter: "Bitmap (*.bmp)",
  pngFilter: "PNG (*.png)",
  bvdFilter: `${B["200"]} (*.bvd)`,
  palFilter: "AM Tileset Palette (*.pal)",
  saveAs: "名前を付けて保存",
  open: "ファイルを開く",

  /** ZigzaguMap だけの案内（ステータスや情報ダイアログ）。 */
  tilesTooMany: (count: number, max: number) => `画像のタイル数（${count}）がタイルセットの上限（${max}）を超えています。上限までを読み込みました。`,
  paletteFileSize: (size: number) => `パレットファイルの大きさが違います（64 バイトのはずが ${size} バイト）。`,
  paletteLoaded: "パレットファイルを読み込みました（「パレットの変更を反映する」で編集中の状態へ入ります）。",
  nothingToCommit: "反映していないパレットの変更はありません。",
  committed: (n: number) => `パレットの変更を反映しました（${n} 本）。`,
  saved: (path: string) => `保存しました: ${path}`,
  notOpen: "マップが開かれていません。",

  // [PalettenForm]
  paletteEditor: ini.PalettenForm.Title,
  apply: ini.PalettenForm["10"],
  gbcValue: ini.PalettenForm["11"],
  hexToRgb: ini.PalettenForm["12"],
  /** 改訂版の [PalettenForm] 13 は注記だけで空なので、overrides.ini で旧版の文言にしてある。 */
  pickColor: ini.PalettenForm["13"],
  paletteLabel: "Palette:",

  // [BlockDatenAnpassenForm]
  adjustTitle: ini.BlockDatenAnpassenForm.Title,
  changeTileset1: ini.BlockDatenAnpassenForm["10"],
  changeTileset2: ini.BlockDatenAnpassenForm["11"],
  adjustHint: ini.BlockDatenAnpassenForm["12"],
  /** 右の欄の見出し（旧版は「パ」の 1 文字。overrides.ini で補正）。 */
  adjustTo: ini.BlockDatenAnpassenForm["13"],
  adjustSave: ini.BlockDatenAnpassenForm["14"],

  /** [Verhalten_FRLG]（挙動。名前の無い値は 16 進 2 桁だけ）。 */
  behaviors: comboItems(hexRecord(ini.Verhalten_FRLG)),
  /** [Hintergrund_FRLG]（背景）。 */
  backgrounds: comboItems(hexRecord(ini.Hintergrund_FRLG)),
} as const;

/** 16 進（大文字、桁そろえ）。 */
export function hexText(n: number, digits: number): string {
  return hex(n, digits);
}
