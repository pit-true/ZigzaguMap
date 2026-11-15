// パレットエディタの Phase5 の機能（#396）の文言。AdvanceMap に無い機能なので ini には無い。
import { formatHex } from "@zigzagumap/core";
import { ini } from "./ini";

export const jaPaletteTools = {
  menuView: "表示",
  viewUnusedColors: "未使用の色",
  menuTools: ini.Menue["13"],
  colorUsage: "色の使用箇所…",
  rgbLabel: "16進のRGB",
  rgbApply: "RGBを反映",
  /** `#RRGGBB` でない。 */
  rgbInvalid: (text: string) => `「${text}」は #RRGGBB（16 進 6 桁）ではありません。`,
  usageTitle: (palette: number, color: number) => `パレット${palette} の色${color} の使用箇所`,
  usageNone: "この色を使っているブロックはありません。",
  usageCount: (n: number) => `${n} 個のブロック（押すとブロックエディタで選ぶ）`,
  usageRow: (block: number) => (block >= 640 ? `ブロック ${formatHex(block, 3)}（タイルセット2の ${formatHex(block - 640, 3)}）` : `ブロック ${formatHex(block, 3)}（タイルセット1）`),
  close: "閉じる",
  /** パレットの読み込みの、ほかの形式も含む絞り込み（#396）。 */
  paletteFilter: "パレット（.pal・JASC-PAL・GIMP の .gpl・Adobe の .act）",
  /** 読み込んだパレットファイルが 16 色でない（AdvanceMap の .pal 以外の形式）。 */
  paletteColors: (format: string, colors: number) =>
    `${({ jasc: "JASC-PAL", gimp: "GIMP のパレット（.gpl）", act: "Adobe のカラーテーブル（.act）" } as Record<string, string>)[format] ?? format} の色の数が 16 ではありません（${colors} 色）。`,
};
