import {
  BLOCK_PIXELS,
  BLOCK_DEFINITION_SIZE,
  BlockRenderer,
  PRIMARY_BLOCK_COUNT,
  TOTAL_BLOCK_COUNT,
  createImage,
  type RgbaImage,
  type Tileset,
} from "@zigzagumap/core";

/**
 * 主・副タイルセットの組。ブロックの描画（キャッシュつき）と、ブロックパレットの画像を持つ。
 * 同じ組のマップどうしで使い回す。
 */
export class TilesetView {
  readonly renderer: BlockRenderer;
  /** 副タイルセットのブロック数（パレットに並べる数）。 */
  readonly secondaryCount: number;
  private readonly paletteImages = new Map<number, RgbaImage>();

  constructor(
    readonly key: string,
    readonly primary: Tileset,
    readonly secondary: Tileset,
  ) {
    this.renderer = new BlockRenderer(primary, secondary);
    this.secondaryCount = blockCount(secondary, TOTAL_BLOCK_COUNT - PRIMARY_BLOCK_COUNT);
  }

  /** パレットに並べるブロックの総数（主の 640 個 + 副）。 */
  get paletteBlockCount(): number {
    return PRIMARY_BLOCK_COUNT + this.secondaryCount;
  }

  /** パレットの行数（主の後ろは行を改めて副を並べる）。 */
  paletteRows(width: number): number {
    return Math.ceil(PRIMARY_BLOCK_COUNT / width) + Math.ceil(this.secondaryCount / width);
  }

  /** パレットの (列, 行) のブロック番号。何も無い位置なら null。 */
  blockAt(col: number, row: number, width: number): number | null {
    if (col < 0 || col >= width || row < 0) return null;
    const primaryRows = Math.ceil(PRIMARY_BLOCK_COUNT / width);
    if (row < primaryRows) {
      const block = row * width + col;
      return block < PRIMARY_BLOCK_COUNT ? block : null;
    }
    const index = (row - primaryRows) * width + col;
    return index < this.secondaryCount ? PRIMARY_BLOCK_COUNT + index : null;
  }

  /** ブロック番号のパレット上の (列, 行)。 */
  positionOf(block: number, width: number): { col: number; row: number } {
    if (block < PRIMARY_BLOCK_COUNT) return { col: block % width, row: Math.floor(block / width) };
    const index = block - PRIMARY_BLOCK_COUNT;
    return { col: index % width, row: Math.ceil(PRIMARY_BLOCK_COUNT / width) + Math.floor(index / width) };
  }

  /** ブロック定義の ROM 上の位置（ステータスバー用）。maps\ から読んだタイルセットなら null。 */
  blockOffset(block: number): number | null {
    const isPrimary = block < PRIMARY_BLOCK_COUNT;
    const base = (isPrimary ? this.primary : this.secondary).header.blocksOffset;
    if (base === 0) return null;
    return base + (isPrimary ? block : block - PRIMARY_BLOCK_COUNT) * BLOCK_DEFINITION_SIZE;
  }

  /** ブロックパレットの画像（幅 `width` ブロック）。データの無い位置は黒。 */
  paletteImage(width: number): RgbaImage {
    let image = this.paletteImages.get(width);
    if (image) return image;
    image = createImage(width * BLOCK_PIXELS, this.paletteRows(width) * BLOCK_PIXELS);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
    const rows = this.paletteRows(width);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < width; col++) {
        const block = this.blockAt(col, row, width);
        if (block !== null) this.renderer.blit(block, image.data, image.width, col * BLOCK_PIXELS, row * BLOCK_PIXELS);
      }
    }
    this.paletteImages.set(width, image);
    return image;
  }
}

/**
 * タイルセットのブロック数。ROM のタイルセットはブロック定義の直後に属性が続くので、その差から数える
 * （AdvanceMap のパレットの行数と合う）。maps\ から読んだものは定義の数をそのまま使う。
 */
function blockCount(tileset: Tileset, max: number): number {
  const { blocksOffset, attributesOffset } = tileset.header;
  const defined = Math.floor(tileset.blocks.length / 8);
  if (blocksOffset > 0 && attributesOffset > blocksOffset) {
    const gap = (attributesOffset - blocksOffset) / BLOCK_DEFINITION_SIZE;
    if (Number.isInteger(gap) && gap > 0 && gap <= max) return gap;
  }
  return Math.min(defined, max);
}
