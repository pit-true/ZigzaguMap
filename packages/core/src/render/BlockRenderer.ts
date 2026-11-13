import { PRIMARY_BLOCK_COUNT, PRIMARY_PALETTE_COUNT, PRIMARY_TILE_COUNT, TILE_BYTES } from "../map/constants.js";
import type { Tileset } from "../map/types.js";
import { writeBgr555 } from "./color.js";

/** ブロック 1 個の一辺のピクセル数。 */
export const BLOCK_PIXELS = 16;
/** ブロック 1 個の RGBA バイト数。 */
const BLOCK_RGBA_BYTES = BLOCK_PIXELS * BLOCK_PIXELS * 4;

/**
 * 主・副タイルセットの組から、ブロック（16×16）を RGBA に描くクラス。
 * 描いたブロックはキャッシュする。AdvanceMap と同じく、下層は色 0 もそのタイルのパレットの色 0 で塗り、
 * 上層は「そのパレットの色 0 と同じ色」の画素を透明にして重ねる（AdvanceMap は色番号ではなく色で抜くため、
 * 色 0 と同じ色を持つ色番号も透けて見える）。
 */
export class BlockRenderer {
  /** 16 本 × 16 色の RGBA パレット（0〜6 は主、7〜15 は副から取る）。 */
  private readonly paletteRgba = new Uint8ClampedArray(16 * 16 * 4);
  private readonly cache = new Map<number, Uint8ClampedArray>();

  constructor(
    private readonly primary: Tileset,
    private readonly secondary: Tileset,
  ) {
    for (let pal = 0; pal < 16; pal++) {
      const source = pal < PRIMARY_PALETTE_COUNT ? primary.palettes : secondary.palettes;
      for (let c = 0; c < 16; c++) writeBgr555(this.paletteRgba, pal * 16 + c, source[pal * 16 + c] ?? 0);
    }
  }

  /** ブロック番号の RGBA（16×16×4 バイト）を返す。定義が無い番号は背景色だけになる。 */
  render(blockId: number): Uint8ClampedArray {
    let image = this.cache.get(blockId);
    if (!image) {
      image = this.draw(blockId);
      this.cache.set(blockId, image);
    }
    return image;
  }

  /** ブロックを `dest`（幅 `destWidth` ピクセル）の (x, y) ピクセル位置へ写す。 */
  blit(blockId: number, dest: Uint8ClampedArray, destWidth: number, x: number, y: number): void {
    const src = this.render(blockId);
    const rowBytes = BLOCK_PIXELS * 4;
    for (let row = 0; row < BLOCK_PIXELS; row++) {
      const s = row * rowBytes;
      dest.set(src.subarray(s, s + rowBytes), ((y + row) * destWidth + x) * 4);
    }
  }

  private draw(blockId: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(BLOCK_RGBA_BYTES);
    // 背景色（パレット 0 の色 0）で塗る。
    for (let i = 0; i < BLOCK_PIXELS * BLOCK_PIXELS; i++) out.set(this.paletteRgba.subarray(0, 4), i * 4);

    const isPrimary = blockId < PRIMARY_BLOCK_COUNT;
    const defs = isPrimary ? this.primary.blocks : this.secondary.blocks;
    const base = (isPrimary ? blockId : blockId - PRIMARY_BLOCK_COUNT) * 8;
    if (base + 8 > defs.length) return out;

    for (let layer = 0; layer < 2; layer++) {
      for (let part = 0; part < 4; part++) {
        const entry = defs[base + layer * 4 + part]!;
        this.drawTile(out, entry, (part & 1) * 8, (part >> 1) * 8, layer === 0);
      }
    }
    return out;
  }

  /**
   * タイル指定（番号 10 ビット、左右反転、上下反転、パレット 4 ビット）を 1 枚描く。
   * `opaque` なら色 0 もそのパレットの色 0 で塗る（下層）。そうでなければ色 0 と同じ色の画素を抜く（上層）。
   */
  private drawTile(out: Uint8ClampedArray, entry: number, ox: number, oy: number, opaque: boolean): void {
    const tile = entry & 0x3ff;
    const hflip = (entry & 0x400) !== 0;
    const vflip = (entry & 0x800) !== 0;
    const pal = (entry >> 12) & 0xf;
    const isPrimary = tile < PRIMARY_TILE_COUNT;
    const tiles = isPrimary ? this.primary.tiles : this.secondary.tiles;
    const start = (isPrimary ? tile : tile - PRIMARY_TILE_COUNT) * TILE_BYTES;
    // 画像の無いタイル番号は、AdvanceMap と同じく全画素が色 0 のタイルとして描く（下層ならそのパレットの色 0 で塗る）
    const missing = start + TILE_BYTES > tiles.length;
    if (missing && !opaque) return;

    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const byte = missing ? 0 : tiles[start + py * 4 + (px >> 1)]!;
        const index = px & 1 ? byte >> 4 : byte & 0xf;
        if (!opaque && (index === 0 || this.sameAsColor0(pal, index))) continue;
        const dx = ox + (hflip ? 7 - px : px);
        const dy = oy + (vflip ? 7 - py : py);
        const p = (pal * 16 + index) * 4;
        const o = (dy * BLOCK_PIXELS + dx) * 4;
        out[o] = this.paletteRgba[p]!;
        out[o + 1] = this.paletteRgba[p + 1]!;
        out[o + 2] = this.paletteRgba[p + 2]!;
        out[o + 3] = 255;
      }
    }
  }

  /** パレット `pal` の色 `index` が、そのパレットの色 0 と同じ色か。 */
  private sameAsColor0(pal: number, index: number): boolean {
    const a = (pal * 16 + index) * 4;
    const z = pal * 16 * 4;
    const c = this.paletteRgba;
    return c[a] === c[z] && c[a + 1] === c[z + 1] && c[a + 2] === c[z + 2];
  }
}
