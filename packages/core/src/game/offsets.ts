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
  /** タイルセットヘッダー（24 バイト）が番号順に並ぶ表の位置（AdvanceMap のタイルセット番号はこの並び）。 */
  readonly tilesetHeaderTable: number;
  /** 表のタイルセットの数。 */
  readonly tilesetCount: number;
  /** フライトポジション（空を飛ぶの行き先、8 バイト）の表へのポインタが置かれている位置（AdvanceMap の FlugposHeader）。 */
  readonly flyTablePointer: number;
  /** フライトポジションの表の件数。 */
  readonly flyTableCount: number;
}

/** ファイアレッド日本語版（BPRJ）。 */
export const BPRJ_OFFSETS: GameOffsets = {
  mapBankTablePointer: 0x54b0c,
  wildHeaderTablePointer: 0x8257c,
  mapNameTablePointer: 0xc1e78,
  tilesetHeaderTable: 0x298b44,
  tilesetCount: 68,
  flyTablePointer: 0xc0e44,
  flyTableCount: 20,
};

/** ゲームコードからオフセット定義を引く表。 */
export const OFFSETS_BY_CODE: Readonly<Record<string, GameOffsets>> = {
  BPRJ: BPRJ_OFFSETS,
};
