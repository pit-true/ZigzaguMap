/**
 * トリプルレイヤー（CFRU の Triple Layer Blocks。ND・Chronos で有効）の判定。
 *
 * - 属性 u32 のビット 28〜30 の値が 3 のブロック N は 3 層で描かれる（4 バイト目で `(b3 >> 4) & 7 == 3`）。
 *   Bochi の判定（`b3 & 0xFC == 0x30`）とはビット 26・27・31 が立つときだけ違うが、実機に合わせる。
 * - 3 枚目は、同じタイルセットのブロック表の N+1 の下層 4 タイル（最初の 8 バイト）。主の 639 番の次は副の 640 番ではない。
 *   N+1 が表の外（主の 639 番、副の最後の番号）なら 3 枚目は描けない（「描けない 3 層」）。
 *
 * ブロック番号はマップと同じ通し番号（主 0〜0x27F、副 0x280〜）。
 */
import { PRIMARY_BLOCK_COUNT } from "../map/constants.js";
import { BLOCK_TILE_COUNT, LAYER_MODE_TRIPLE, isUndrawnLayerMode, layerMode } from "./blockFormat.js";

/** ブロック表 1 つ（`Tileset` と `TilesetDocument` のどちらも渡せる）。 */
export interface BlockTable {
  /** ブロック定義（1 ブロック 8 個の u16）。 */
  readonly blocks: Uint16Array;
  /** ブロック属性（1 ブロック 1 個の u32）。 */
  readonly attributes: Uint32Array;
}

/** 属性が 3 層か（ビット 28〜30 が 3）。 */
export function isTripleLayer(attribute: number): boolean {
  return layerMode(attribute) === LAYER_MODE_TRIPLE;
}

/** 表のブロック数（定義の数）。 */
export function tableBlockCount(table: BlockTable): number {
  return Math.floor(table.blocks.length / BLOCK_TILE_COUNT);
}

/** 表の中の番号 `local` の属性（無ければ 0）。 */
export function localAttribute(table: BlockTable, local: number): number {
  return (table.attributes[local] ?? 0) >>> 0;
}

/** 表の中の 3 層のブロック `local` の 3 枚目に使う番号（`local + 1`）。表の外なら null。 */
export function thirdLayerLocal(table: BlockTable, local: number): number | null {
  const next = local + 1;
  return next < tableBlockCount(table) ? next : null;
}

/** 表の中の番号 `local` が、1 つ前の 3 層のブロックの 3 枚目に使われているか。 */
export function isLocalTripleChild(table: BlockTable, local: number): boolean {
  return local > 0 && local < tableBlockCount(table) && isTripleLayer(localAttribute(table, local - 1));
}

/** ブロック 1 つの重ね方の情報（自動操作の `blockInfo` と、パレット・描く道具・ブロックエディタが使う）。 */
export interface TripleLayerInfo {
  /** 通し番号。 */
  readonly block: number;
  /** 重ね方の値（ビット 28〜30、0〜7）。 */
  readonly layerMode: number;
  /** 3 層か。 */
  readonly triple: boolean;
  /** 1 つ前の 3 層のブロックの 3 枚目に使われているか（「3 層の次の番号」）。 */
  readonly tripleChild: boolean;
  /** 3 層だが 3 枚目が表の外で描けないか。 */
  readonly unresolved: boolean;
  /** 実機ではこのマスを描かない値（5〜7）か。 */
  readonly undrawn: boolean;
}

/**
 * 主・副の組で、通し番号のブロックの重ね方を引く。タイルセットの組ごとに作り、編集のたびに作り直さなくてよい
 * （配列を毎回見るので、属性やブロック数を変えてもそのまま正しい値を返す。ただし配列が差し替わったら作り直す）。
 */
export class TripleLayerIndex {
  constructor(
    private readonly primary: BlockTable,
    private readonly secondary: BlockTable,
  ) {}

  /** 通し番号の持ち主と表の中の番号。 */
  private locate(block: number): { table: BlockTable; local: number } {
    return block < PRIMARY_BLOCK_COUNT ? { table: this.primary, local: block } : { table: this.secondary, local: block - PRIMARY_BLOCK_COUNT };
  }

  /** ブロックの属性（表に無ければ 0）。 */
  attribute(block: number): number {
    const { table, local } = this.locate(block);
    return localAttribute(table, local);
  }

  /** 3 層か。 */
  isTriple(block: number): boolean {
    return isTripleLayer(this.attribute(block));
  }

  /** 3 層の次の番号か（1 つ前の 3 層のブロックの 3 枚目に使われているか）。 */
  isTripleChild(block: number): boolean {
    const { table, local } = this.locate(block);
    return isLocalTripleChild(table, local);
  }

  /** 3 層の次の番号なら、その親（3 層のブロック）の通し番号。違えば null。 */
  parentOf(block: number): number | null {
    return this.isTripleChild(block) ? block - 1 : null;
  }

  /** 3 層のブロックの 3 枚目に使う通し番号。3 層でないか表の外なら null。 */
  thirdOf(block: number): number | null {
    if (!this.isTriple(block)) return null;
    const { table, local } = this.locate(block);
    const next = thirdLayerLocal(table, local);
    return next === null ? null : block + 1;
  }

  /** 表の最後のブロック（3 層にすると 3 枚目が表の外になる）か。 */
  isLastOfTable(block: number): boolean {
    const { table, local } = this.locate(block);
    return local === tableBlockCount(table) - 1;
  }

  /** まとめた情報。 */
  info(block: number): TripleLayerInfo {
    const attribute = this.attribute(block);
    const mode = layerMode(attribute);
    const triple = mode === LAYER_MODE_TRIPLE;
    const { table, local } = this.locate(block);
    return {
      block,
      layerMode: mode,
      triple,
      tripleChild: isLocalTripleChild(table, local),
      unresolved: triple && thirdLayerLocal(table, local) === null,
      undrawn: isUndrawnLayerMode(mode),
    };
  }
}
