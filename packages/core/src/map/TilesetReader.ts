import type { Rom } from "../rom/Rom.js";
import {
  BLOCK_ATTRIBUTE_SIZE,
  BLOCK_DEFINITION_SIZE,
  PRIMARY_BLOCK_COUNT,
  PRIMARY_TILE_COUNT,
  TILESET_HEADER_SIZE,
  TILE_BYTES,
  TOTAL_BLOCK_COUNT,
  TOTAL_TILE_COUNT,
} from "./constants.js";
import type { Tileset, TilesetHeader } from "./types.js";

/** パレットデータの色数（16 本 × 16 色）。 */
const PALETTE_COLORS = 16 * 16;

/** タイルセットヘッダー（24 バイト）と、その先のタイル画像・パレット・ブロック定義・属性を読むクラス。 */
export class TilesetReader {
  constructor(private readonly rom: Rom) {}

  /** `offset` のタイルセットヘッダーだけを読む。 */
  readHeader(offset: number): TilesetHeader {
    const rom = this.rom;
    rom.check(offset, TILESET_HEADER_SIZE);
    return {
      offset,
      isCompressed: rom.u8(offset + 0x00) !== 0,
      isSecondary: rom.u8(offset + 0x01) !== 0,
      tilesOffset: rom.pointer(offset + 0x04),
      palettesOffset: rom.pointer(offset + 0x08),
      blocksOffset: rom.pointer(offset + 0x0c),
      callback: rom.u32(offset + 0x10),
      attributesOffset: rom.pointer(offset + 0x14),
    };
  }

  /**
   * タイルセットを読む。`asSecondary` は、マップのどちら側に置かれているか
   * （ヘッダーの isSecondary ではなく、フッターでの位置で決める）。
   */
  read(offset: number, asSecondary: boolean): Tileset {
    const rom = this.rom;
    const header = this.readHeader(offset);
    const maxTiles = asSecondary ? TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT : PRIMARY_TILE_COUNT;
    const maxBlocks = asSecondary ? TOTAL_BLOCK_COUNT - PRIMARY_BLOCK_COUNT : PRIMARY_BLOCK_COUNT;

    let tiles: Uint8Array;
    if (header.isCompressed) {
      const raw = rom.lz77(header.tilesOffset);
      tiles = raw.length > maxTiles * TILE_BYTES ? raw.subarray(0, maxTiles * TILE_BYTES) : raw;
    } else {
      tiles = rom.slice(header.tilesOffset, clampLength(rom.size, header.tilesOffset, maxTiles * TILE_BYTES, TILE_BYTES));
    }

    const palettes = rom.u16Array(header.palettesOffset, PALETTE_COLORS);

    const blockBytes = clampLength(rom.size, header.blocksOffset, maxBlocks * BLOCK_DEFINITION_SIZE, BLOCK_DEFINITION_SIZE);
    const blocks = rom.u16Array(header.blocksOffset, blockBytes / 2);

    const attrBytes = clampLength(rom.size, header.attributesOffset, maxBlocks * BLOCK_ATTRIBUTE_SIZE, BLOCK_ATTRIBUTE_SIZE);
    const attributes = new Uint32Array(attrBytes / 4);
    for (let i = 0; i < attributes.length; i++) attributes[i] = rom.u32(header.attributesOffset + i * 4);

    return { header, tiles, palettes, blocks, attributes };
  }
}

/** ROM の末尾を越えないように長さを詰める（単位の倍数に切り下げ）。 */
function clampLength(romSize: number, offset: number, wanted: number, unit: number): number {
  const available = Math.max(0, romSize - offset);
  const length = Math.min(wanted, available);
  return length - (length % unit);
}
