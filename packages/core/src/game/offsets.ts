/**
 * ゲームごとのオフセット定義。ROM 内の固定位置はすべてこのファイルに集める。
 * 値は ROM 先頭からのオフセット（0x08000000 を引いた値）。
 */
export interface GameOffsets {
  /** マップバンク表へのポインタが置かれている位置。 */
  readonly mapBankTablePointer: number;
  /** 野生ヘッダー表（昼）へのポインタが置かれている位置。 */
  readonly wildHeaderTablePointer: number;
  /** マップ名表へのポインタが置かれている位置。 */
  readonly mapNameTablePointer: number;
  /** 種族名表（gSpeciesNames）へのポインタが置かれている位置。 */
  readonly speciesNameTablePointer: number;
  /** OW の画像情報の表（gObjectEventGraphicsInfoPointers）へのポインタが置かれている位置。 */
  readonly overworldGraphicsTablePointer: number;
  /** OW のパレット表（sObjectEventSpritePalettes）へのポインタが置かれている位置。 */
  readonly overworldPaletteTablePointer: number;
}

/** ファイアレッド日本語版（BPRJ）。 */
export const BPRJ_OFFSETS: GameOffsets = {
  mapBankTablePointer: 0x54b0c,
  wildHeaderTablePointer: 0x8257c,
  mapNameTablePointer: 0xc1e78,
  speciesNameTablePointer: 0x144,
  overworldGraphicsTablePointer: 0x5ebb4,
  overworldPaletteTablePointer: 0x5ed98,
};

/** ゲームコードからオフセット定義を引く表。 */
export const OFFSETS_BY_CODE: Readonly<Record<string, GameOffsets>> = {
  BPRJ: BPRJ_OFFSETS,
};
