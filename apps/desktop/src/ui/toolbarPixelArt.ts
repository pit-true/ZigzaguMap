import { gridFromRgba, gridFromRows, overlayGrid, pixelIconSvg, type PixelGrid } from "./pixelIcon";

/**
 * ツールバーのドット絵のアイコン（#541）: 新規マップの作成・新規マップの挿入・ワールドマップエディタ。
 * どれも 15×15 ドット（2 倍で 30×30、影を足して 32×32）。描き方は docs/toolbar-icons.md。
 *
 * - 色はこの表の 1 文字で書く（`.` は透明）。輪郭は `K`、明るい面・暗い面の 2〜3 段で陰影を付ける。1 つの絵の色は GBA と同じく 16 色まで。
 * - ワールドマップエディタは、ROM を開いたら ROM のタウンマップから切り出した 13×13 に輪郭を付けたものに差し替える
 *   （`worldMapIconFromTownMap`）。ゲームの絵はリポジトリに入れない。下の `WORLD_FALLBACK` は自作の代わりの絵。
 */
export const PIXEL_COLORS: Readonly<Record<string, string>> = {
  K: "#202028", // 輪郭
  G: "#68c048", // 草
  g: "#388830", // 草の影
  L: "#a8e068", // 草の明るい所
  T: "#185828", // 木の輪郭
  t: "#409838", // 木の葉
  P: "#e8c878", // 道
  p: "#c09850", // 道の影
  R: "#d84830", // 屋根
  r: "#902820", // 屋根の影・印の影
  W: "#f0e8d0", // 壁
  w: "#b8a888", // 壁の影
  D: "#405888", // 戸・ガラス
  S: "#68a0e8", // 海
  s: "#4070c8", // 水道（深い海）
  H: "#a8d0f8", // 海の明るい筋
  E: "#e02820", // 町の印
  X: "#f8f8f8", // 町の印の光
  Y: "#ffd828", // 星
  y: "#b06000", // 星の輪郭
  O: "#e8a010", // 星の影
  A: "#2878d8", // 矢印
  a: "#104090", // 矢印の輪郭
  N: "#78b8f8", // 矢印の光
};

/** マップの札（12×12）: 草地・道・木・家。 */
const MAP_CARD = [
  ".KKKKKKKKKK.",
  "KGGGGGGGTTGK",
  "KGGLGGGTLtTK",
  "KGGGGGGTttTK",
  "KGGGGGGgTTgK",
  "KGGGGGRRRGGK",
  "KGGGGRRRRRGK",
  "KGLGrrrrrrrK",
  "KGGGGWWWDwGK",
  "KGPPPWDWWwGK",
  "KGPpGWDWWwGK",
  ".KKKKKKKKKK.",
];

/** 「新規」の星（7×7）。 */
const STAR = [
  "...y...",
  "..yWy..",
  "yyWYYyy",
  "yWYYYOy",
  ".yYYOy.",
  ".yYyOy.",
  ".yy.yy.",
];

/** 「挿入」の矢印（7×8）。 */
const ARROW = [
  "...a...",
  "...aa..",
  "aaaaNa.",
  "aNNNNNa",
  "aAAAAAa",
  "aaaaAa.",
  "...aa..",
  "...a...",
];

/** ROM を開く前・読めないときのワールドマップの絵（15×15）: 西の海岸、道、町の印、南の水道。 */
const WORLD_FALLBACK = [
  ".KKKKKKKKKKKKK.",
  "KSSSgGGGGPPGGGK",
  "KHHHgGGGGPPGGGK",
  "KSSgGGGGKEEKGGK",
  "KSSgGGGGEXEEGGK",
  "KHHgGGGGEEErGGK",
  "KSSgGGGGKrrKGGK",
  "KSSSgGGGGPPGGgK",
  "KHHHgGGGGPPGgSK",
  "KSSSSgGGGPPgSSK",
  "KHHHHSggppgSHHK",
  "KSSSSSSssSSSSSK",
  "KHHHHHHssHHHHHK",
  "KSSSSSSssSSSSSK",
  ".KKKKKKKKKKKKK.",
];

/** 15×15 の透明な台。 */
const BLANK = gridFromRows(Array.from({ length: 15 }, () => "".padEnd(15, ".")), PIXEL_COLORS);

const rows = (r: readonly string[]): PixelGrid => gridFromRows(r, PIXEL_COLORS);

/** 新規マップの作成（札の左上に星）。 */
export const NEW_MAP_ICON = pixelIconSvg(overlayGrid(overlayGrid(BLANK, rows(MAP_CARD), 3, 3), rows(STAR), 0, 0), "newMap");
/** 新規マップの挿入（札の左から矢印）。 */
export const INSERT_MAP_ICON = pixelIconSvg(overlayGrid(overlayGrid(BLANK, rows(MAP_CARD), 3, 3), rows(ARROW), 0, 5), "insertMap");
/** ワールドマップエディタ（ROM を開く前・読めないとき）。 */
export const WORLD_MAP_FALLBACK_ICON = pixelIconSvg(rows(WORLD_FALLBACK), "worldMap");

/** 輪郭の札（15×15。角は透明）。 */
const FRAME = rows([
  ".KKKKKKKKKKKKK.",
  ...Array.from({ length: 13 }, () => "K.............K"),
  ".KKKKKKKKKKKKK.",
]);

/** ROM のタウンマップから切り出した 13×13 の画素に輪郭を付けて、ワールドマップエディタのアイコンにする。 */
export function worldMapIconFromTownMap(image: { readonly width: number; readonly height: number; readonly data: ArrayLike<number> }): string {
  return pixelIconSvg(overlayGrid(FRAME, gridFromRgba(image), 1, 1), "worldMap");
}
