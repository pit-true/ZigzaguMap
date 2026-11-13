/**
 * ゲームごとのオフセット定義。ROM 内の固定位置はすべてこのファイルに集める。
 * 値は ROM 先頭からのオフセット（0x08000000 を引いた値）。
 */
export interface GameOffsets {
  /** マップバンク表へのポインタが置かれている位置。 */
  readonly mapBankTablePointer: number;
}

/** ファイアレッド日本語版（BPRJ）。 */
export const BPRJ_OFFSETS: GameOffsets = {
  mapBankTablePointer: 0x54b0c,
};

/** ゲームコードからオフセット定義を引く表。 */
export const OFFSETS_BY_CODE: Readonly<Record<string, GameOffsets>> = {
  BPRJ: BPRJ_OFFSETS,
};
