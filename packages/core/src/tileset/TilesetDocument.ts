import { sha256Hex } from "../binary/sha256.js";
import {
  BLOCK_ATTRIBUTE_SIZE,
  BLOCK_DEFINITION_SIZE,
  PRIMARY_BLOCK_COUNT,
  PRIMARY_TILE_COUNT,
  TILESET_HEADER_SIZE,
  TILE_BYTES,
  TOTAL_BLOCK_COUNT,
  TOTAL_TILE_COUNT,
} from "../map/constants.js";
import type { Tileset } from "../map/types.js";
import { TILESET_SOURCE_FORMAT, TilesetSourceJson, type TilesetSource } from "../project/TilesetSource.js";
import type { DeflateFunction } from "../project/png/deflate.js";
import type { InflateFunction } from "../project/png/inflate.js";
import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { BLOCK_TILE_COUNT } from "./blockFormat.js";
import { TILES_PER_ROW, encodeTilesPng } from "./TileImage.js";

/** タイルセットの指し方（マップの PrimaryTileset / SecondaryTileset の値と、どちら側か）。 */
export interface TilesetRef {
  /** ヘッダーのポインタ値（0x08000000 起点）。 */
  readonly pointer: number;
  /** 副タイルセットとして使うか。 */
  readonly secondary: boolean;
}

/** パレットの色数（16 本 × 16 色）。 */
const PALETTE_COLORS = 256;
/** タイル画像の最小のタイル数（PNG の 1 行）。 */
const MIN_TILES = 16;
/** ヘッダーの各ポインタの位置（画像・パレット・ブロック・属性）。 */
const HEADER_POINTER_FIELDS = [0x04, 0x08, 0x0c, 0x14] as const;
/** 副タイルセットが使う最初のパレット（tiles.png の色に使う）。 */
const SECONDARY_IMAGE_PALETTE = 7;

/** TilesetDocument を作るときに渡す中身。 */
export interface TilesetDocumentInit {
  pointer: number;
  secondary: boolean;
  /** maps\tilesets のフォルダ名に使う位置（ROM 先頭から）。既存のタイルセットはヘッダーの位置。 */
  headerAddress: number;
  isNew: boolean;
  /** ヘッダー 24 バイト（ポインタの部分は 0）。 */
  header: Uint8Array;
  compressed: boolean;
  /** 4bpp タイル画像（16 の倍数のタイル数）。 */
  tiles: Uint8Array;
  palettes: Uint16Array;
  blocks: Uint16Array;
  attributes: Uint32Array;
}

/**
 * 編集できるタイルセット 1 つ（タイル画像・パレット・ブロック定義・属性）。
 * ROM か maps\tilesets から読んだコピーで、ROM は変えない。tileset.json と tiles.png に書き出せる。
 */
export class TilesetDocument {
  readonly pointer: number;
  readonly secondary: boolean;
  readonly headerAddress: number;
  readonly isNew: boolean;
  /** ヘッダー 24 バイト（ポインタの部分は 0）。 */
  header: Uint8Array;
  compressed: boolean;
  /** 4bpp タイル画像（1 枚 32 バイト）。 */
  tiles: Uint8Array;
  /** パレット（BGR555、16 本 × 16 色）。 */
  palettes: Uint16Array;
  /** ブロック定義（1 ブロック 8 個の u16）。 */
  blocks: Uint16Array;
  /** ブロック属性（1 ブロック 1 個の u32）。 */
  attributes: Uint32Array;

  constructor(init: TilesetDocumentInit) {
    this.pointer = init.pointer >>> 0;
    this.secondary = init.secondary;
    this.headerAddress = init.headerAddress;
    this.isNew = init.isNew;
    this.header = init.header;
    this.compressed = init.compressed;
    this.tiles = init.tiles;
    this.palettes = init.palettes;
    this.blocks = init.blocks;
    this.attributes = init.attributes;
  }

  /** 指し方。 */
  get ref(): TilesetRef {
    return { pointer: this.pointer, secondary: this.secondary };
  }

  /** タイル数。 */
  get tileCount(): number {
    return this.tiles.length / TILE_BYTES;
  }

  /** ブロック数。 */
  get blockCount(): number {
    return this.attributes.length;
  }

  /** 置けるタイル数の上限（主 640、副 384）。 */
  get tileCapacity(): number {
    return this.secondary ? TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT : PRIMARY_TILE_COUNT;
  }

  /** ブロック数の上限（主 640、副 384）。 */
  get blockCapacity(): number {
    return this.secondary ? TOTAL_BLOCK_COUNT - PRIMARY_BLOCK_COUNT : PRIMARY_BLOCK_COUNT;
  }

  /** tiles.png に使うパレットの番号（主 0、副 7。Bochi と同じ）。 */
  get imagePalette(): number {
    return this.secondary ? SECONDARY_IMAGE_PALETTE : 0;
  }

  /** 描画用の形（配列は共有する。編集はそのまま描画に出る）。 */
  toTileset(): Tileset {
    return {
      header: {
        offset: this.pointer - ROM_BASE,
        isCompressed: this.compressed,
        isSecondary: this.header[1] !== 0,
        tilesOffset: 0,
        palettesOffset: 0,
        blocksOffset: 0,
        callback: (this.header[0x10]! | (this.header[0x11]! << 8) | (this.header[0x12]! << 16) | (this.header[0x13]! << 24)) >>> 0,
        attributesOffset: 0,
      },
      tiles: this.tiles,
      palettes: this.palettes,
      blocks: this.blocks,
      attributes: this.attributes,
    };
  }

  /** 深いコピー。 */
  clone(): TilesetDocument {
    return new TilesetDocument({
      pointer: this.pointer,
      secondary: this.secondary,
      headerAddress: this.headerAddress,
      isNew: this.isNew,
      header: this.header.slice(),
      compressed: this.compressed,
      tiles: this.tiles.slice(),
      palettes: this.palettes.slice(),
      blocks: this.blocks.slice(),
      attributes: this.attributes.slice(),
    });
  }

  /**
   * ROM から読む。タイル数とブロック数は Bochi の CaptureTilesetSource に近い方法で決める:
   * - タイル: 圧縮なら展開した長さ、無圧縮なら次のデータの手前まで。16 以上・上限以下にして 16 の倍数に切り上げる。
   * - ブロック: ブロック表・属性表の後ろの次のデータまで（副はさらに 0xFF で埋まったブロックの手前まで）。
   * `dataStarts` はタイルセットのデータの開始位置の一覧（TilesetTable.dataStarts）。
   */
  static fromRom(rom: Rom, ref: TilesetRef, dataStarts: readonly number[] = []): TilesetDocument {
    const at = ref.pointer - ROM_BASE;
    rom.check(at, TILESET_HEADER_SIZE);
    const header = rom.slice(at, TILESET_HEADER_SIZE).slice();
    const compressed = header[0] !== 0;
    const tilesAt = rom.pointer(at + 0x04);
    const palettesAt = rom.pointer(at + 0x08);
    const blocksAt = rom.pointer(at + 0x0c);
    const attrValue = rom.u32(at + 0x14);
    const attributesAt = rom.isPointer(attrValue) ? attrValue - ROM_BASE : 0;
    const own = [tilesAt, palettesAt, blocksAt, attributesAt].filter((v) => v > 0);
    const next = (from: number) => nextStart(dataStarts, own, from, rom.size);
    const tileCapacity = ref.secondary ? TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT : PRIMARY_TILE_COUNT;
    const blockCapacity = ref.secondary ? TOTAL_BLOCK_COUNT - PRIMARY_BLOCK_COUNT : PRIMARY_BLOCK_COUNT;

    const raw = compressed ? rom.lz77(tilesAt) : rom.slice(tilesAt, Math.min(rom.size - tilesAt, tileCapacity * TILE_BYTES));
    let tileCount = Math.floor(raw.length / TILE_BYTES);
    if (!compressed) tileCount = Math.min(tileCount, Math.floor((next(tilesAt) - tilesAt) / TILE_BYTES));
    tileCount = Math.max(MIN_TILES, Math.min(tileCount, tileCapacity));
    const rows = Math.ceil(tileCount / TILES_PER_ROW);
    const tiles = new Uint8Array(rows * TILES_PER_ROW * TILE_BYTES);
    tiles.set(raw.subarray(0, Math.min(raw.length, tileCount * TILE_BYTES, tiles.length)));

    let blockCount = Math.floor((next(blocksAt) - blocksAt) / BLOCK_DEFINITION_SIZE);
    if (attributesAt > 0) blockCount = Math.min(blockCount, Math.floor((next(attributesAt) - attributesAt) / BLOCK_ATTRIBUTE_SIZE));
    if (ref.secondary) {
      for (let i = 0; i < blockCapacity; i++) {
        const o = blocksAt + i * BLOCK_DEFINITION_SIZE;
        if (o + BLOCK_DEFINITION_SIZE > rom.size || rom.slice(o, BLOCK_DEFINITION_SIZE).every((b) => b === 0xff)) {
          blockCount = Math.min(blockCount, i);
          break;
        }
      }
    }
    blockCount = Math.min(blockCapacity, blockCount);
    if (blockCount <= 0) blockCount = blockCapacity;
    blockCount = Math.min(blockCount, Math.floor((rom.size - blocksAt) / BLOCK_DEFINITION_SIZE));

    const attributes = new Uint32Array(blockCount);
    if (attributesAt > 0) {
      for (let i = 0; i < blockCount && rom.inRange(attributesAt + i * 4, 4); i++) attributes[i] = rom.u32(attributesAt + i * 4);
    }
    for (const field of HEADER_POINTER_FIELDS) header.fill(0, field, field + 4);
    return new TilesetDocument({
      pointer: ref.pointer,
      secondary: ref.secondary,
      headerAddress: at,
      isNew: false,
      header,
      compressed,
      tiles,
      palettes: rom.u16Array(palettesAt, PALETTE_COLORS),
      blocks: rom.u16Array(blocksAt, blockCount * BLOCK_TILE_COUNT),
      attributes,
    });
  }

  /** maps\tilesets の tileset.json と tiles.png から作る。 */
  static fromSource(source: TilesetSource, png: Uint8Array, inflate?: InflateFunction): TilesetDocument {
    const tileset = TilesetSourceJson.toTileset(source, png, inflate);
    const tiles = new Uint8Array(Math.ceil(source.tileCount / TILES_PER_ROW) * TILES_PER_ROW * TILE_BYTES);
    tiles.set(tileset.tiles.subarray(0, Math.min(tileset.tiles.length, tiles.length)));
    return new TilesetDocument({
      pointer: ROM_BASE + source.headerAddress,
      secondary: source.secondary,
      headerAddress: source.headerAddress,
      isNew: source.isNew,
      header: source.header.slice(),
      compressed: source.compressed,
      tiles,
      palettes: tileset.palettes.slice(),
      blocks: tileset.blocks.slice(),
      attributes: tileset.attributes.slice(),
    });
  }

  /** tileset.json の中身にする（Bochi の CaptureTilesetSource と同じ項目）。 */
  toSource(): TilesetSource {
    return {
      format: TILESET_SOURCE_FORMAT,
      headerAddress: this.headerAddress,
      secondary: this.secondary,
      isNew: this.isNew,
      header: this.header.slice(),
      tileCount: this.tileCount,
      blockCount: this.blockCount,
      blockBytes: BLOCK_DEFINITION_SIZE,
      behaviorBytes: BLOCK_ATTRIBUTE_SIZE,
      compressed: this.compressed,
      imageSha256: sha256Hex(this.tiles),
      palettes: u16ToBytes(this.palettes),
      blocks: u16ToBytes(this.blocks),
      behaviors: u32ToBytes(this.attributes),
    };
  }

  /** tileset.json の文字列（Bochi と同じ整形）。 */
  toJson(): string {
    return TilesetSourceJson.stringify(this.toSource());
  }

  /** tiles.png（4bpp インデックス、横 128、色は imagePalette のパレット）。 */
  toPng(deflate?: DeflateFunction): Uint8Array {
    const p = this.imagePalette * 16;
    return encodeTilesPng(this.tiles, this.palettes.subarray(p, p + 16), this.tileCount, deflate);
  }
}

function nextStart(starts: readonly number[], own: readonly number[], from: number, end: number): number {
  let next = end;
  for (const s of starts) if (s > from && s < next) next = s;
  for (const s of own) if (s > from && s < next) next = s;
  return next;
}

function u16ToBytes(values: Uint16Array): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  values.forEach((v, i) => {
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = v >> 8;
  });
  return out;
}

function u32ToBytes(values: Uint32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => {
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >>> 8) & 0xff;
    out[i * 4 + 2] = (v >>> 16) & 0xff;
    out[i * 4 + 3] = (v >>> 24) & 0xff;
  });
  return out;
}
