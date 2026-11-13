/** 条件表の 1 件（8 バイト）。 */
export interface MapScriptTableEntry {
  /** 条件の変数。 */
  variable: number;
  /** 条件の値。 */
  value: number;
  /** スクリプトへのポインタ（そのままの値）。 */
  script: number;
}

/** 条件表（種類 2・4 が指す）。 */
export interface MapScriptTable {
  /** 変数が 0 でない件。 */
  entries: MapScriptTableEntry[];
  /**
   * 終端の件（変数 0 から始まる 8 バイト）とその後ろのバイト。
   * ROM から読んだときは終端の 8 バイトをそのまま持つ（2 バイト目以降も保つため）。
   */
  tail: Uint8Array;
}

/** マップスクリプトの一覧の 1 件。 */
export interface MapScriptEntry {
  /** 種類（1〜7）。 */
  type: number;
  /** ポインタ（そのままの値）。条件表を持つ件では表の位置。 */
  pointer: number;
  /** 種類 2・4 で、ポインタの先の条件表。無ければ null。 */
  table: MapScriptTable | null;
}
