import { PRIMARY_BLOCK_COUNT, PRIMARY_PALETTE_COUNT, PRIMARY_TILE_COUNT, TILE_BYTES } from "../map/constants.js";
import type { Tileset } from "../map/types.js";
import { isTripleLayer, localAttribute, thirdLayerLocal } from "../tileset/tripleLayer.js";
import { createImage, writeBgr555, type RgbaImage } from "./color.js";

/** ブロック 1 個の一辺のピクセル数。 */
export const BLOCK_PIXELS = 16;
/** 描くレイヤー（Phase7 #513。ビットの組み合わせ）: 下のレイヤー。 */
export const LAYER_BOTTOM = 1;
/** 上のレイヤー。 */
export const LAYER_TOP = 2;
/** トリプルレイヤーの 3 枚目。 */
export const LAYER_THIRD = 4;
/** 全部のレイヤー（既定。今までと同じ絵）。 */
export const ALL_LAYERS = LAYER_BOTTOM | LAYER_TOP | LAYER_THIRD;

/** ブロック 1 個の RGBA バイト数。 */
const BLOCK_RGBA_BYTES = BLOCK_PIXELS * BLOCK_PIXELS * 4;

/**
 * 主・副タイルセットの組から、ブロック（16×16）を RGBA に描くクラス。
 * 描いたブロックはキャッシュする。AdvanceMap と同じく、下層は色 0 もそのタイルのパレットの色 0 で塗り、
 * 上層は「そのパレットの色 0 と同じ色」の画素を透明にして重ねる（AdvanceMap は色番号ではなく色で抜くため、
 * 色 0 と同じ色を持つ色番号も透けて見える）。
 * 3 層のブロック（属性のビット 28〜30 が 3。tileset/tripleLayer.ts）は、同じ表の次のブロックの下層 4 タイルを
 * 上層と同じ透かし方で 3 枚目として重ねる（次のブロックが表の外なら 3 枚目は描かない）。
 */
export class BlockRenderer {
  /** 16 本 × 16 色の RGBA パレット（0〜6 は主、7〜15 は副から取る）。上のレイヤーを透かす判定に使う。 */
  private readonly paletteRgba = new Uint8ClampedArray(16 * 16 * 4);
  /** 画素に書く色。時間帯の色（`tinted`）を渡されたらその色、無ければ paletteRgba と同じもの。 */
  private readonly drawRgba: Uint8ClampedArray;
  private readonly cache = new Map<number, Uint8ClampedArray>();
  private readonly gameCache = new Map<string, Uint8ClampedArray>();

  /**
   * `tinted` は、時間帯の色に変えた後の 256 色（BGR555。Phase6 #433）。上のレイヤーを透かす判定は変える前の色で比べる
   * （時間帯の計算は 1 対 1 でなく、別の色が同じ色になることがあるため）。省けば今までと同じ絵になる。
   * `layers` は描くレイヤー（Phase7 #513。LAYER_BOTTOM などの組み合わせ）。外したレイヤーは描かない（下を外すと背景色の上に上を重ねる）。
   * 省けば全部で、今までと同じ絵になる。`render`・`blit` だけに適用し、実機の BG の絵（`renderGamePlane` など）には適用しない。
   */
  constructor(
    private readonly primary: Tileset,
    private readonly secondary: Tileset,
    tinted?: ArrayLike<number>,
    readonly layers: number = ALL_LAYERS,
  ) {
    for (let pal = 0; pal < 16; pal++) {
      const source = pal < PRIMARY_PALETTE_COUNT ? primary.palettes : secondary.palettes;
      for (let c = 0; c < 16; c++) writeBgr555(this.paletteRgba, pal * 16 + c, source[pal * 16 + c] ?? 0);
    }
    if (tinted) {
      this.drawRgba = new Uint8ClampedArray(16 * 16 * 4);
      for (let i = 0; i < 256; i++) writeBgr555(this.drawRgba, i, tinted[i] ?? 0);
    } else this.drawRgba = this.paletteRgba;
  }

  /** 描いて持っているブロックの数。 */
  get cachedCount(): number {
    return this.cache.size + this.gameCache.size;
  }

  /** 実機のBG1/2/3を別々に描く。編集画面の既存の合成とは独立し、色番号0だけを透かす。 */
  renderGamePlane(blockId: number, plane: 1 | 2 | 3, cfru: boolean): Uint8ClampedArray | null {
    const key = `${+cfru}:${blockId}:${plane}`;
    const cached = this.gameCache.get(key);
    if (cached) return cached;
    const primary = blockId < PRIMARY_BLOCK_COUNT;
    const table = primary ? this.primary : this.secondary;
    const local = primary ? blockId : blockId - PRIMARY_BLOCK_COUNT;
    if (!Number.isInteger(local) || local < 0 || local * 8 + 8 > table.blocks.length) return null;
    const attribute = localAttribute(table, local);
    const mode = cfru ? (attribute >>> 28) & 7 : (attribute >>> 29) & 3;
    const plan = gameLayerPlan(mode, cfru);
    if (!plan) return null;
    const out = new Uint8ClampedArray(BLOCK_RGBA_BYTES);
    if (plan.fallback && plane === 3) {
      // mapbg.c の WATER_CHR_CODE。通常ブロックの透明な下層から見えるBG3。
      for (let part = 0; part < 4; part++) this.drawTile(out, 0x3014, (part & 1) * 8, (part >> 1) * 8, false, false);
    }
    for (let layer = 0; layer < plan.planes.length; layer++) {
      if (plan.planes[layer] !== plane) continue;
      const base = layer === 2 ? thirdLayerLocal(table, local) : local;
      if (base === null) continue;
      const tileBase = base * 8 + (layer === 1 ? 4 : 0);
      for (let part = 0; part < 4; part++) this.drawTile(out, table.blocks[tileBase + part]!, (part & 1) * 8, (part >> 1) * 8, false, false);
    }
    this.gameCache.set(key, out);
    return out;
  }

  /**
   * マップのブロックの代わりに、8 個のタイル指定と重ね方を直接渡して BG1/2/3 の 1 枚を描く（ドアの仮のブロック。#474）。
   * 3 枚目を使う重ね方は描けない（null）。覚えないので、呼ぶ側が必要なら持つ。
   */
  renderGameCell(entries: ArrayLike<number>, mode: number, plane: 1 | 2 | 3, cfru: boolean): Uint8ClampedArray | null {
    const plan = gameLayerPlan(mode, cfru);
    if (!plan || plan.planes.length > 2 || entries.length < 8) return null;
    const out = new Uint8ClampedArray(BLOCK_RGBA_BYTES);
    if (plan.fallback && plane === 3) {
      for (let part = 0; part < 4; part++) this.drawTile(out, 0x3014, (part & 1) * 8, (part >> 1) * 8, false, false);
    }
    for (let layer = 0; layer < plan.planes.length; layer++) {
      if (plan.planes[layer] !== plane) continue;
      for (let part = 0; part < 4; part++) this.drawTile(out, entries[layer * 4 + part]!, (part & 1) * 8, (part >> 1) * 8, false, false);
    }
    return out;
  }

  /** BGの色番号0が透けた先の色。時間帯の色も反映する。 */
  backdropColor(): readonly [number, number, number, number] {
    return [this.drawRgba[0]!, this.drawRgba[1]!, this.drawRgba[2]!, 255];
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

  /**
   * ブロックを `dest`（幅 `destWidth` ピクセル）の (x, y) ピクセル位置へ写す。
   * `keep` が false なら、まだ描いていないブロックを描いても覚えない（ブロックパレットのように全部を 1 回だけ描くとき）。
   */
  blit(blockId: number, dest: Uint8ClampedArray, destWidth: number, x: number, y: number, keep = true): void {
    const src = keep ? this.render(blockId) : (this.cache.get(blockId) ?? this.draw(blockId));
    const rowBytes = BLOCK_PIXELS * 4;
    for (let row = 0; row < BLOCK_PIXELS; row++) {
      const s = row * rowBytes;
      dest.set(src.subarray(s, s + rowBytes), ((y + row) * destWidth + x) * 4);
    }
  }

  private draw(blockId: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(BLOCK_RGBA_BYTES);
    // 背景色（パレット 0 の色 0）で塗る。
    for (let i = 0; i < BLOCK_PIXELS * BLOCK_PIXELS; i++) out.set(this.drawRgba.subarray(0, 4), i * 4);

    const isPrimary = blockId < PRIMARY_BLOCK_COUNT;
    const defs = isPrimary ? this.primary.blocks : this.secondary.blocks;
    const base = (isPrimary ? blockId : blockId - PRIMARY_BLOCK_COUNT) * 8;
    if (base + 8 > defs.length) return out;

    const layers = this.layers;
    for (let layer = 0; layer < 2; layer++) {
      if ((layers & (layer === 0 ? LAYER_BOTTOM : LAYER_TOP)) === 0) continue;
      for (let part = 0; part < 4; part++) {
        const entry = defs[base + layer * 4 + part]!;
        this.drawTile(out, entry, (part & 1) * 8, (part >> 1) * 8, layer === 0);
      }
    }
    const table = isPrimary ? this.primary : this.secondary;
    const local = base / 8;
    if ((layers & LAYER_THIRD) !== 0 && isTripleLayer(localAttribute(table, local))) {
      const third = thirdLayerLocal(table, local);
      if (third !== null) {
        for (let part = 0; part < 4; part++) this.drawTile(out, defs[third * 8 + part]!, (part & 1) * 8, (part >> 1) * 8, false);
      }
    }
    return out;
  }

  /**
   * タイル指定（番号 10 ビット、左右反転、上下反転、パレット 4 ビット）を 1 枚描く。
   * `opaque` なら色 0 もそのパレットの色 0 で塗る（下層）。そうでなければ色 0 と同じ色の画素を抜く（上層）。
   */
  private drawTile(out: Uint8ClampedArray, entry: number, ox: number, oy: number, opaque: boolean, colorKey = true): void {
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
        if (!opaque && (index === 0 || (colorKey && this.sameAsColor0(pal, index)))) continue;
        const dx = ox + (hflip ? 7 - px : px);
        const dy = oy + (vflip ? 7 - py : py);
        const p = (pal * 16 + index) * 4;
        const o = (dy * BLOCK_PIXELS + dx) * 4;
        out[o] = this.drawRgba[p]!;
        out[o + 1] = this.drawRgba[p + 1]!;
        out[o + 2] = this.drawRgba[p + 2]!;
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

/** 元の日本語版とCFRUの分岐表。各値は下層・上層・3枚目の行き先のBG番号。 */
export function gameLayerPlan(mode: number, cfru: boolean): { readonly planes: readonly number[]; readonly fallback: boolean } | null {
  if (!cfru) {
    if (mode === 0) return { planes: [2, 1], fallback: true };
    if (mode === 1) return { planes: [3, 2], fallback: false };
    if (mode === 2) return { planes: [3, 1], fallback: false };
    return null;
  }
  if (mode === 0 || mode === 1) return { planes: [2, 1], fallback: true };
  if (mode === 2) return { planes: [3, 2], fallback: false };
  if (mode === 3) return { planes: [3, 2, 1], fallback: false };
  if (mode === 4) return { planes: [3, 1], fallback: false };
  return null;
}

/**
 * `width`×`height` マスのブロックを並べた画像を描く。`blockAt` は各マスのブロック番号（移動許可を除いた値）で、
 * null・undefined を返したマスは描かない（透明のまま）。
 */
export function renderBlocks(
  renderer: BlockRenderer,
  width: number,
  height: number,
  blockAt: (x: number, y: number) => number | null | undefined,
): RgbaImage {
  const image = createImage(width * BLOCK_PIXELS, height * BLOCK_PIXELS);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const block = blockAt(x, y);
      if (block !== null && block !== undefined) renderer.blit(block, image.data, image.width, x * BLOCK_PIXELS, y * BLOCK_PIXELS);
    }
  }
  return image;
}
