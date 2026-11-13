/** 野生ヘッダー（20 バイト）。ポインタはそのままの値（無ければ 0）。 */
export interface WildHeader {
  bank: number;
  map: number;
  padding: number;
  /** 陸・水・岩砕き・釣りのエリア情報へのポインタ。 */
  areas: [number, number, number, number];
}

/** エリア情報（8 バイト）。 */
export interface WildInfo {
  /** 出現率。 */
  rate: number;
  padding1: number;
  padding2: number;
  /** スロットの一覧へのポインタ。 */
  slots: number;
}

/** スロット（4 バイト）。 */
export interface WildSlot {
  minLevel: number;
  maxLevel: number;
  /** 種族番号。 */
  species: number;
}

/** エリア 1 つ分の野生。スロットが空ならそのエリアには出ない。 */
export interface WildArea {
  rate: number;
  slots: WildSlot[];
}

/** 1 マップ・1 時間帯分の野生（エリアは陸・水・岩砕き・釣りの 4 つ）。 */
export interface WildEncounters {
  /** 時間帯（WildTime の値）。 */
  time: number;
  areas: WildArea[];
}
