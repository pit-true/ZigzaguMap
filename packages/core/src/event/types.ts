/** イベントの型。ポインタはそのままの値（0x08000000 起点、無ければ 0）で持つ。 */

/** イベントヘッダー（20 バイト）。 */
export interface EventHeader {
  personCount: number;
  warpCount: number;
  trapCount: number;
  signCount: number;
  /** 人の一覧へのポインタ。 */
  persons: number;
  /** ワープの一覧へのポインタ。 */
  warps: number;
  /** スクリプトタイルの一覧へのポインタ。 */
  traps: number;
  /** 看板の一覧へのポインタ。 */
  signs: number;
}

/** 人（24 バイト）。 */
export interface PersonEvent {
  /** 番号（スクリプトから指す ID）。 */
  localId: number;
  /** 見た目の番号。 */
  graphicsId: number;
  /** 種類（0: 通常、1: クローン）。 */
  kind: number;
  padding1: number;
  x: number;
  y: number;
  /** 高さ。クローンでは参照先の番号。 */
  elevation: number;
  /** 動き方。 */
  movementType: number;
  /** 移動範囲 X（4 ビット）。 */
  movementRangeX: number;
  /** 移動範囲 Y（4 ビット）。 */
  movementRangeY: number;
  padding2: number;
  /** トレーナーの種類。クローンでは参照先のマップ番号。 */
  trainerType: number;
  /** トレーナーの視界、またはきのみの木の番号。クローンでは参照先のバンク番号。 */
  trainerRangeOrBerryTree: number;
  /** スクリプトへのポインタ。 */
  script: number;
  /** 表示・非表示のフラグ。 */
  flag: number;
  padding3: number;
}

/** ワープ（8 バイト）。 */
export interface WarpEvent {
  x: number;
  y: number;
  elevation: number;
  /** 行き先のワープ番号。 */
  warpId: number;
  /** 行き先のマップ番号。 */
  map: number;
  /** 行き先のバンク番号。 */
  bank: number;
}

/** スクリプトタイル（16 バイト）。 */
export interface TrapEvent {
  x: number;
  y: number;
  elevation: number;
  padding1: number;
  /** 条件の変数。 */
  variable: number;
  /** 条件の値。 */
  value: number;
  padding2: number;
  /** スクリプトへのポインタ。 */
  script: number;
}

/** 看板の中身: スクリプト。 */
export interface SignScript {
  readonly type: "script";
  /** スクリプトへのポインタ。 */
  script: number;
}

/** 看板の中身: 隠しアイテム。 */
export interface SignHiddenItem {
  readonly type: "hiddenItem";
  /** 道具番号。 */
  item: number;
  /** 隠しアイテムのフラグ番号（8 ビット）。 */
  flag: number;
  /** 個数（7 ビット）。 */
  amount: number;
  /** 足元でだけ拾えるか（最上位ビット）。 */
  underfoot: boolean;
}

/** 看板（12 バイト）。種別によって中身がスクリプトか隠しアイテムになる。 */
export interface SignEvent {
  x: number;
  y: number;
  elevation: number;
  /** 種別（0〜4: スクリプト、5〜7: 隠しアイテム）。 */
  kind: number;
  padding: number;
  content: SignScript | SignHiddenItem;
}

/** 1 マップ分のイベント。 */
export interface MapEvents {
  persons: PersonEvent[];
  warps: WarpEvent[];
  traps: TrapEvent[];
  signs: SignEvent[];
}
