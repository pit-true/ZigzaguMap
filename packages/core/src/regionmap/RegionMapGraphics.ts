import { createImage, writeBgr555, type RgbaImage } from "../render/color.js";
import type { Rom } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import type { RegionMapAddresses } from "./addresses.js";
import { REGION_IMAGE_HEIGHT, REGION_IMAGE_WIDTH, REGION_PALETTE_COLORS, REGION_SCREEN_TILES_X, REGION_SCREEN_TILES_Y } from "./constants.js";

/** タウンマップの絵の元データ（JSON にでき、別ウィンドウへそのまま渡せる形）。 */
export interface RegionMapGraphicsData {
  /** BGR555 の 80 色（5 本）。 */
  palette: number[];
  /** 4bpp のタイル（展開後）。 */
  tiles: number[];
  /** 4 枚のタイルマップ（各 30×20 の u16）。 */
  screens: number[][];
}

/** 読んだ位置（表示用）。 */
export interface RegionMapGraphicsSource {
  readonly palette: number;
  readonly tiles: number;
  readonly screens: readonly number[];
}

/**
 * タウンマップの背景（BG0）の絵。パレットは圧縮なし、タイルとタイルマップは LZ77 圧縮。
 * TransTmapData（0x080C141C）が読むものと同じ。
 */
export class RegionMapGraphics {
  constructor(readonly data: RegionMapGraphicsData) {}

  /** ROM から読む。 */
  static read(rom: Rom, addresses: RegionMapAddresses): { graphics: RegionMapGraphics; source: RegionMapGraphicsSource } {
    const paletteAt = rom.pointer(addresses.palettePointer);
    const tilesAt = rom.pointer(addresses.tilesPointer);
    const screensAt = addresses.screenPointers.map((p) => rom.pointer(p));
    const palette = [...rom.u16Array(paletteAt, REGION_PALETTE_COLORS)];
    const tiles = [...rom.lz77(tilesAt)];
    const screens = screensAt.map((at) => {
      const raw = rom.lz77(at);
      if (raw.length < REGION_SCREEN_TILES_X * REGION_SCREEN_TILES_Y * 2) throw new RomError(`タウンマップのタイルマップが短すぎます (0x${at.toString(16)})`);
      const out: number[] = [];
      for (let i = 0; i < REGION_SCREEN_TILES_X * REGION_SCREEN_TILES_Y; i++) out.push(raw[i * 2]! | (raw[i * 2 + 1]! << 8));
      return out;
    });
    return {
      graphics: new RegionMapGraphics({ palette, tiles, screens }),
      source: { palette: paletteAt, tiles: tilesAt, screens: screensAt },
    };
  }

  /** 面（0〜3）の絵を描く（240×160）。色 0 はパレット 0 の色 0。 */
  render(page: number): RgbaImage {
    return this.renderArea(page, 0, 0, REGION_IMAGE_WIDTH, REGION_IMAGE_HEIGHT);
  }

  /**
   * 面（0〜3）の絵の一部（左上 `left`・`top` から `width`×`height` の画素）を描く。読み方は `render` と同じ。
   * 絵の外の画素は透明のまま。
   */
  renderArea(page: number, left: number, top: number, width: number, height: number): RgbaImage {
    const { palette, tiles, screens } = this.data;
    const screen = screens[page];
    if (!screen) throw new RangeError(`タウンマップの面が範囲外です: ${page}`);
    const image = createImage(width, height);
    for (let y = 0; y < height; y++) {
      const py = top + y;
      if (py < 0 || py >= REGION_IMAGE_HEIGHT) continue;
      for (let x = 0; x < width; x++) {
        const px = left + x;
        if (px < 0 || px >= REGION_IMAGE_WIDTH) continue;
        const entry = screen[(py >> 3) * REGION_SCREEN_TILES_X + (px >> 3)]!;
        const tile = entry & 0x3ff;
        const sy = entry & 0x800 ? 7 - (py & 7) : py & 7;
        const sx = entry & 0x400 ? 7 - (px & 7) : px & 7;
        const pal = (entry >> 12) * 16;
        const byte = tiles[tile * 32 + sy * 4 + (sx >> 1)] ?? 0;
        const index = sx & 1 ? byte >> 4 : byte & 15;
        const color = index === 0 ? palette[0]! : palette[(pal + index) % REGION_PALETTE_COLORS]!;
        writeBgr555(image.data, y * width + x, color);
      }
    }
    return image;
  }
}
