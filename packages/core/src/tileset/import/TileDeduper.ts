/**
 * 画像からタイルとブロックを作る（Phase6 #440）: 色番号に直した 8×8 のタイルの重複を除く。DOM に依存しない。
 *
 * - そのままと、左右・上下・両方の反転の 4 通りで探す（反転を使わない設定もある）。
 * - 探す先は、今あるタイル（書く先のタイルセットと、副なら主も。番号の小さいものを先に）と、この取り込みで新しく作ったタイル。
 * - タイルは色番号で比べる（パレットはブロックの側に持つ。GBA の作りどおり）。
 */
import { TILE_BYTES } from "../../map/constants.js";

/** 探す先の、今あるタイルの集まり。 */
export interface ExistingTiles {
  /** 最初のタイルの通し番号（主 0、副 0x280）。 */
  readonly base: number;
  /** 4bpp のタイル（1 枚 32 バイト）。 */
  readonly tiles: Uint8Array;
  /** 探すタイルの数（省略で全部）。 */
  readonly count?: number;
  /** 探さないタイル（タイルセットの中の番号。主の 0 番の扱いなどに使う）。 */
  readonly skip?: (local: number) => boolean;
}

/** 重複の除き方。 */
export interface TileDedupeOptions {
  /** 反転で同じになるタイルもまとめる（既定 true）。 */
  readonly useFlip?: boolean;
  /** 今あるタイルを使い回す（既定 true）。 */
  readonly reuseExisting?: boolean;
}

/** 1 枚の結果。 */
export interface TileMatch {
  /** 今あるタイルを使うなら、その通し番号。 */
  readonly existing: number | null;
  /** 新しく作るタイルなら、新しいタイルの中の番号（0 から）。 */
  readonly created: number | null;
  readonly hflip: boolean;
  readonly vflip: boolean;
}

/** 数（どれも重ならない）。 */
export interface TileDedupeCounts {
  /** 新しく作るタイル。 */
  readonly created: number;
  /** 今あるタイルをそのまま使った数。 */
  readonly reused: number;
  /** 新しく作ったタイルと同じだった数（反転なし）。 */
  readonly merged: number;
  /** 反転でまとめた数（今あるタイル・新しいタイルのどちらも）。 */
  readonly flipped: number;
}

/** 色番号 64 個（0〜15）を 4bpp の 32 バイトにする（偶数の x が下位 4 ビット。GBA と同じ）。 */
export function packTile(indices: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(TILE_BYTES);
  for (let i = 0; i < 64; i += 2) out[i >> 1] = (indices[i]! & 0xf) | ((indices[i + 1]! & 0xf) << 4);
  return out;
}

/** 4bpp の 32 バイトを色番号 64 個にする。 */
export function unpackTile(bytes: Uint8Array, offset = 0): Uint8Array {
  const out = new Uint8Array(64);
  for (let i = 0; i < 32; i++) {
    const b = bytes[offset + i] ?? 0;
    out[i * 2] = b & 0xf;
    out[i * 2 + 1] = b >> 4;
  }
  return out;
}

/** 色番号 64 個を反転する。 */
export function flipIndices(indices: ArrayLike<number>, hflip: boolean, vflip: boolean): Uint8Array {
  const out = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) out[y * 8 + x] = indices[(vflip ? 7 - y : y) * 8 + (hflip ? 7 - x : x)]!;
  }
  return out;
}

function keyOf(bytes: Uint8Array, offset = 0): string {
  let s = "";
  for (let i = 0; i < TILE_BYTES; i++) s += String.fromCharCode(bytes[offset + i]!);
  return s;
}

/** 反転の 4 通り（探す順）。 */
const ORIENTATIONS: readonly (readonly [boolean, boolean])[] = [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
];

/** 色番号のタイルを 1 枚ずつ足し、同じタイルを探す。 */
export class TileDeduper {
  private readonly index = new Map<string, { existing: number | null; created: number | null }>();
  private readonly useFlip: boolean;
  /** 新しく作るタイル（4bpp）。 */
  readonly createdTiles: Uint8Array[] = [];
  /** 使った今あるタイルの通し番号。 */
  readonly usedExisting = new Set<number>();
  private counts = { created: 0, reused: 0, merged: 0, flipped: 0 };

  constructor(existing: readonly ExistingTiles[], options: TileDedupeOptions = {}) {
    this.useFlip = options.useFlip ?? true;
    if (options.reuseExisting ?? true) {
      for (const set of existing) {
        const count = Math.min(set.count ?? Infinity, Math.floor(set.tiles.length / TILE_BYTES));
        for (let local = 0; local < count; local++) {
          if (set.skip?.(local)) continue;
          const key = keyOf(set.tiles, local * TILE_BYTES);
          if (!this.index.has(key)) this.index.set(key, { existing: set.base + local, created: null });
        }
      }
    }
  }

  /** 数。 */
  get stats(): TileDedupeCounts {
    return { ...this.counts };
  }

  /** 色番号 64 個のタイルを足す。同じものがあればそれを、無ければ新しいタイルを返す。 */
  add(indices: ArrayLike<number>): TileMatch {
    const orientations = this.useFlip ? ORIENTATIONS : ORIENTATIONS.slice(0, 1);
    for (const [h, v] of orientations) {
      const hit = this.index.get(keyOf(packTile(h || v ? flipIndices(indices, h, v) : indices)));
      if (!hit) continue;
      if (h || v) this.counts.flipped++;
      else if (hit.existing !== null) this.counts.reused++;
      else this.counts.merged++;
      if (hit.existing !== null) this.usedExisting.add(hit.existing);
      return { existing: hit.existing, created: hit.created, hflip: h, vflip: v };
    }
    const bytes = packTile(indices);
    const created = this.createdTiles.length;
    this.createdTiles.push(bytes);
    this.index.set(keyOf(bytes), { existing: null, created });
    this.counts.created++;
    return { existing: null, created, hflip: false, vflip: false };
  }
}
