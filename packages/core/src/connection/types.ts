/** 接続ヘッダー（8 バイト）。 */
export interface ConnectionHeader {
  /** 件数（u32）。 */
  count: number;
  /** 接続の一覧へのポインタ（そのままの値）。 */
  connections: number;
}

/** 接続 1 件（12 バイト）。 */
export interface MapConnection {
  /** 方向（u32。ConnectionDirection の値）。 */
  direction: number;
  /** ずれ（ブロック数、符号つき）。 */
  offset: number;
  /** 相手のバンク番号。 */
  bank: number;
  /** 相手のマップ番号。 */
  map: number;
  padding: number;
}
