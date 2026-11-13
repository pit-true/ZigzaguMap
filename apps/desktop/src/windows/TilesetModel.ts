import {
  BLOCK_TILE_COUNT,
  BlockRenderer,
  PRIMARY_BLOCK_COUNT,
  PRIMARY_PALETTE_COUNT,
  PRIMARY_TILE_COUNT,
  TILE_BYTES,
  decodeBase64,
  writeBgr555,
  type Tileset,
} from "@zigzagumap/core";
import type { TilesetData, ToolSnapshot, ToolUiState } from "./protocol";

/** ブロックの持ち主（タイルセットと、その中の番号）。 */
export interface BlockOwner {
  readonly data: TilesetData;
  /** タイルセットの中の番号（副も 0 から）。 */
  readonly local: number;
}

/**
 * 別ウィンドウが表示に使うタイルセットの組（メインから届いた写しを復元したもの）。
 * ブロック番号・タイル番号は AdvanceMap と同じ通し番号（主 0〜0x27F、副 0x280〜）。
 * パレットは 0〜6 を主、7〜15 を副から取る。一時適用した色（ui.preview）を重ねた「表示の色」も持つ。
 */
export class TilesetModel {
  readonly primary: TilesetData | null;
  readonly secondary: TilesetData | null;
  /** 確定した色でブロックを描く（ブロック一覧用）。 */
  readonly renderer: BlockRenderer | null;
  /** 表示の色（BGR555 × 256、一時適用を重ねたもの）。 */
  readonly palettes = new Uint16Array(256);
  private readonly tiles: [Uint8Array, Uint8Array];
  private readonly blocks: [Uint16Array, Uint16Array];
  private readonly rgba = new Uint8ClampedArray(256 * 4);

  constructor(snapshot: ToolSnapshot, ui: ToolUiState) {
    this.primary = snapshot.primary;
    this.secondary = snapshot.secondary;
    this.tiles = [decodeTiles(this.primary), decodeTiles(this.secondary)];
    this.blocks = [decodeBlocks(this.primary), decodeBlocks(this.secondary)];
    for (let pal = 0; pal < 16; pal++) {
      const source = pal < PRIMARY_PALETTE_COUNT ? this.primary : this.secondary;
      const preview = ui.preview[pal];
      for (let c = 0; c < 16; c++) this.palettes[pal * 16 + c] = preview?.[c] ?? source?.palettes[pal * 16 + c] ?? 0;
    }
    for (let i = 0; i < 256; i++) writeBgr555(this.rgba, i, this.palettes[i]!);
    this.renderer =
      this.primary && this.secondary ? new BlockRenderer(toTileset(this.primary, this.tiles[0], this.blocks[0]), toTileset(this.secondary, this.tiles[1], this.blocks[1])) : null;
  }

  /** 副タイルセットのブロック数。 */
  get secondaryBlockCount(): number {
    return this.secondary?.attributes.length ?? 0;
  }

  /** 主のブロック数（一覧は主の 640 個のあとに副を並べる）。 */
  get primaryBlockCount(): number {
    return this.primary?.attributes.length ?? 0;
  }

  /** 一覧に並べるブロックの数（主の枠 640 + 副）。 */
  get listedBlocks(): number {
    return PRIMARY_BLOCK_COUNT + this.secondaryBlockCount;
  }

  /** ブロックの持ち主。無い番号なら null。 */
  owner(block: number): BlockOwner | null {
    if (block < PRIMARY_BLOCK_COUNT) return this.primary && block < this.primaryBlockCount ? { data: this.primary, local: block } : null;
    const local = block - PRIMARY_BLOCK_COUNT;
    return this.secondary && local < this.secondaryBlockCount ? { data: this.secondary, local } : null;
  }

  /** ブロックのタイル指定 8 個（無い番号なら null）。 */
  blockTiles(block: number): number[] | null {
    const o = this.owner(block);
    if (!o) return null;
    const defs = this.blocks[o.data.secondary ? 1 : 0];
    return [...defs.subarray(o.local * BLOCK_TILE_COUNT, o.local * BLOCK_TILE_COUNT + BLOCK_TILE_COUNT)];
  }

  /** ブロックの属性（無い番号なら 0）。 */
  attribute(block: number): number {
    const o = this.owner(block);
    return o ? (o.data.attributes[o.local] ?? 0) >>> 0 : 0;
  }

  /** ベース ROM でのブロック定義の位置（Offset 欄）。 */
  blockOffset(block: number): number | null {
    const o = this.owner(block);
    return o && o.data.romBlocksOffset !== null ? o.data.romBlocksOffset + o.local * 16 : null;
  }

  /** パレットの表示の色 16 個。 */
  colors(palette: number): number[] {
    return [...this.palettes.subarray(palette * 16, palette * 16 + 16)];
  }

  /** パレットの確定した色 16 個（一時適用を除く）。 */
  committedColors(palette: number): number[] {
    const source = palette < PRIMARY_PALETTE_COUNT ? this.primary : this.secondary;
    return source ? source.palettes.slice(palette * 16, palette * 16 + 16) : new Array<number>(16).fill(0);
  }

  /** タイルの 4bpp データ（32 バイト）。無ければ null。 */
  tileBytes(tile: number): Uint8Array | null {
    const secondary = tile >= PRIMARY_TILE_COUNT;
    const data = this.tiles[secondary ? 1 : 0];
    const start = (secondary ? tile - PRIMARY_TILE_COUNT : tile) * TILE_BYTES;
    return start + TILE_BYTES <= data.length ? data.subarray(start, start + TILE_BYTES) : null;
  }

  /** タイルセットのブロック定義と属性（.bvd の保存用）。 */
  blockData(secondary: boolean): { blocks: Uint16Array; attributes: Uint32Array } {
    const data = secondary ? this.secondary : this.primary;
    return { blocks: this.blocks[secondary ? 1 : 0], attributes: Uint32Array.from(data?.attributes ?? []) };
  }

  /** タイルセットのタイル（4bpp、主か副の全部）。 */
  tilesOf(secondary: boolean): Uint8Array {
    return this.tiles[secondary ? 1 : 0];
  }

  /**
   * タイル 1 枚（8×8）を RGBA の画像の (x, y) に描く。色 0（透明）と無いタイルは黒（AdvanceMap と同じ）。
   * パレットは表示の色を使う。
   */
  drawTile(out: Uint8ClampedArray, outWidth: number, tile: number, palette: number, hflip: boolean, vflip: boolean, x: number, y: number): void {
    const bytes = this.tileBytes(tile);
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const b = bytes ? bytes[py * 4 + (px >> 1)]! : 0;
        const index = px & 1 ? b >> 4 : b & 0xf;
        const o = ((y + (vflip ? 7 - py : py)) * outWidth + x + (hflip ? 7 - px : px)) * 4;
        if (index === 0) {
          out[o] = 0;
          out[o + 1] = 0;
          out[o + 2] = 0;
        } else {
          const p = ((palette & 0xf) * 16 + index) * 4;
          out[o] = this.rgba[p]!;
          out[o + 1] = this.rgba[p + 1]!;
          out[o + 2] = this.rgba[p + 2]!;
        }
        out[o + 3] = 255;
      }
    }
  }

  /** タイル指定（u16）を 1 枚描く。透明な画素は描かない（上層を重ねる用）か、黒にする。 */
  drawTileRef(out: Uint8ClampedArray, outWidth: number, ref: number, x: number, y: number, transparent: boolean): void {
    const tile = ref & 0x3ff;
    const hflip = (ref & 0x400) !== 0;
    const vflip = (ref & 0x800) !== 0;
    const palette = (ref >> 12) & 0xf;
    if (!transparent) {
      this.drawTile(out, outWidth, tile, palette, hflip, vflip, x, y);
      return;
    }
    const bytes = this.tileBytes(tile);
    if (!bytes) return;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const b = bytes[py * 4 + (px >> 1)]!;
        const index = px & 1 ? b >> 4 : b & 0xf;
        if (index === 0) continue;
        const o = ((y + (vflip ? 7 - py : py)) * outWidth + x + (hflip ? 7 - px : px)) * 4;
        const p = (palette * 16 + index) * 4;
        out[o] = this.rgba[p]!;
        out[o + 1] = this.rgba[p + 1]!;
        out[o + 2] = this.rgba[p + 2]!;
        out[o + 3] = 255;
      }
    }
  }
}

function decodeTiles(data: TilesetData | null): Uint8Array {
  return data ? decodeBase64(data.tiles) : new Uint8Array(0);
}

function decodeBlocks(data: TilesetData | null): Uint16Array {
  if (!data) return new Uint16Array(0);
  const bytes = decodeBase64(data.blocks);
  const out = new Uint16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
  return out;
}

function toTileset(data: TilesetData, tiles: Uint8Array, blocks: Uint16Array): Tileset {
  return {
    header: {
      offset: 0,
      isCompressed: false,
      isSecondary: data.secondary,
      tilesOffset: 0,
      palettesOffset: 0,
      blocksOffset: 0,
      callback: 0,
      attributesOffset: 0,
    },
    tiles,
    palettes: Uint16Array.from(data.palettes),
    blocks,
    attributes: Uint32Array.from(data.attributes),
  };
}
