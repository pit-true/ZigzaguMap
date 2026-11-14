import { gridOf, singleGrid, type AutoPenFile } from "../types.js";

/**
 * 素の BPRJ（ファイアレッド日本語版）の主タイルセット（0x298B44）の既定のパーツ（#313。Q7 の推奨 b）。
 * ZigzaguMap で ROM のタイルセットと全マップの並びを調べて作った（マップから候補を作る機能の結果を手で直したもの）。
 * Bochi の定義ファイルは使っていない。英語版（BPRE）の同じタイルセットもブロックのデータが同じなので識別子で当たる。
 * 移動許可が null のマスは、描くときに使用回数でいちばん多い値を使う。
 */
export const BPRJ_PRIMARY_DEFAULTS: AutoPenFile = {
  tileset: { secondary: false, game: "BPRJ", headerAddress: 0x298b44, fingerprint: "6424177ed34ad673", blockCount: 640, name: "BPRJ TS1 0x298B44" },
  parts: [
    {
      name: "池（岩の岸）",
      kind: "edge",
      role: "water",
      order: 0,
      slots: {
        NW: singleGrid(0x120),
        N: singleGrid(0x123),
        NE: singleGrid(0x121),
        W: singleGrid(0x12a),
        C: singleGrid(0x12b),
        E: singleGrid(0x12c),
        SW: singleGrid(0x132),
        S: singleGrid(0x133),
        SE: singleGrid(0x134),
        INW: singleGrid(0x131),
        INE: singleGrid(0x130),
      },
    },
    { name: "草むら", kind: "fill", role: "grass", order: 1, slots: { Blocks: singleGrid(0x00d) } },
    {
      name: "木",
      kind: "repeat",
      role: "tree",
      order: 2,
      slots: {
        Top: gridOf(2, 1, [0x00e, 0x00f]),
        Body: gridOf(2, 2, [0x01c, 0x01d, 0x014, 0x015]),
        Bottom: gridOf(2, 1, [0x024, 0x025]),
        BodyEdge: gridOf(2, 2, [0x01e, 0x01f, 0x016, 0x017]),
        BottomEdge: gridOf(2, 1, [0x026, 0x027]),
        BodyTip: gridOf(2, 1, [0x01e, 0x01f]),
      },
    },
    { name: "段差（下へ跳ぶ）", kind: "fill", role: "cliff", order: 3, slots: { Blocks: gridOf(3, 1, [0x087, 0x0b1, 0x0b0]) } },
    { name: "段差（右へ跳ぶ）", kind: "fill", role: "cliff", order: 4, slots: { Blocks: gridOf(2, 1, [0x086, 0x084]) } },
    { name: "段差（左へ跳ぶ）", kind: "fill", role: "cliff", order: 5, slots: { Blocks: singleGrid(0x085) } },
    {
      name: "ポケモンセンター",
      kind: "piece",
      role: "building",
      order: 6,
      slots: {
        Body: gridOf(
          5,
          4,
          [0x048, 0x049, 0x04a, 0x04b, 0x187, 0x050, 0x051, 0x052, 0x053, 0x18f, 0x058, 0x059, 0x05a, 0x05b, 0x197, 0x060, 0x061, 0x062, 0x186, 0x19f],
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, null, 1, 1],
        ),
      },
    },
    {
      name: "フレンドリィショップ",
      kind: "piece",
      role: "building",
      order: 7,
      slots: {
        Body: gridOf(4, 3, [0x030, 0x031, 0x032, 0x033, 0x038, 0x039, 0x03a, 0x03b, 0x040, 0x041, 0x062, 0x063], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, null, 1]),
      },
    },
  ],
};

/** 同梱の既定のパーツの全部。 */
export const DEFAULT_PART_FILES: readonly AutoPenFile[] = [BPRJ_PRIMARY_DEFAULTS];
