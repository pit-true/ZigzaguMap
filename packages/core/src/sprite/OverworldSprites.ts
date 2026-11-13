import { ROM_BASE, type Rom } from "../rom/Rom.js";
import { createImage, writeBgr555, type RgbaImage } from "../render/color.js";

/** OW の画像情報（ObjectEventGraphicsInfo）1 件のバイト数。 */
const GRAPHICS_INFO_SIZE = 0x24;
/** 画像の 1 コマ（SpriteFrameImage）のバイト数。 */
const FRAME_SIZE = 8;
/** 読む画像番号の上限（壊れた表で回り続けないため）。 */
const MAX_GRAPHICS = 0x400;
/** パレット表の件数の上限。 */
const MAX_PALETTES = 0x100;

/** OW 1 種類の情報。 */
export interface OverworldGraphicsInfo {
  readonly paletteTag: number;
  readonly width: number;
  readonly height: number;
  /** 1 コマ目（下向きの立ち姿）の画像データの位置。 */
  readonly imageOffset: number;
}

/**
 * OW（人などのスプライト）の表。画像番号から 1 コマ目（下向き）の画像を作る。
 * 画像は 4bpp のタイルを横に並べたもの（無圧縮）で、パレットの 0 番は透明。作った画像は覚えておく。
 */
export class OverworldSprites {
  private readonly infos = new Map<number, OverworldGraphicsInfo | null>();
  private readonly images = new Map<number, RgbaImage | null>();
  private palettes: Map<number, number> | null = null;

  private constructor(
    private readonly rom: Rom,
    /** 画像情報の表の位置。 */
    readonly graphicsTable: number,
    /** パレット表の位置。 */
    readonly paletteTable: number,
  ) {}

  /** 表へのポインタが置かれている位置から読む。 */
  static read(rom: Rom, graphicsTablePointer: number, paletteTablePointer: number): OverworldSprites {
    return new OverworldSprites(rom, rom.pointer(graphicsTablePointer), rom.pointer(paletteTablePointer));
  }

  /** 画像番号の情報。読めなければ null。 */
  info(graphicsId: number): OverworldGraphicsInfo | null {
    if (!Number.isInteger(graphicsId) || graphicsId < 0 || graphicsId >= MAX_GRAPHICS) return null;
    const cached = this.infos.get(graphicsId);
    if (cached !== undefined) return cached;
    let out: OverworldGraphicsInfo | null = null;
    try {
      const rom = this.rom;
      const entry = this.graphicsTable + graphicsId * 4;
      if (rom.inRange(entry, 4) && rom.isPointer(rom.u32(entry))) {
        const at = rom.pointer(entry);
        rom.check(at, GRAPHICS_INFO_SIZE);
        const width = rom.u16(at + 8);
        const height = rom.u16(at + 10);
        const frames = rom.pointer(at + 0x1c);
        rom.check(frames, FRAME_SIZE);
        const imageOffset = rom.pointer(frames);
        const valid =
          rom.u16(at) === 0xffff && width > 0 && height > 0 && width <= 128 && height <= 128 && width % 8 === 0 && height % 8 === 0;
        if (valid && rom.inRange(imageOffset, (width * height) / 2)) out = { paletteTag: rom.u16(at + 2), width, height, imageOffset };
      }
    } catch {
      out = null;
    }
    this.infos.set(graphicsId, out);
    return out;
  }

  /** 1 コマ目（下向き）の画像（RGBA、パレット 0 番は透明）。読めなければ null。 */
  image(graphicsId: number): RgbaImage | null {
    const cached = this.images.get(graphicsId);
    if (cached !== undefined) return cached;
    const info = this.info(graphicsId);
    const palette = info ? this.paletteOffset(info.paletteTag) : null;
    const out = info && palette !== null ? this.decode(info, palette) : null;
    this.images.set(graphicsId, out);
    return out;
  }

  /** パレットのタグから、パレット（16 色）の位置を引く。無ければ null。 */
  paletteOffset(tag: number): number | null {
    if (!this.palettes) {
      this.palettes = new Map();
      const rom = this.rom;
      for (let i = 0; i < MAX_PALETTES; i++) {
        const at = this.paletteTable + i * 8;
        if (!rom.inRange(at, 8)) break;
        const value = rom.u32(at);
        if (value === 0 || !rom.isPointer(value)) break;
        const t = rom.u16(at + 4);
        if (!this.palettes.has(t)) this.palettes.set(t, value - ROM_BASE);
      }
    }
    const at = this.palettes.get(tag);
    return at !== undefined && this.rom.inRange(at, 32) ? at : null;
  }

  private decode(info: OverworldGraphicsInfo, paletteAt: number): RgbaImage {
    const { width, height } = info;
    const image = createImage(width, height);
    const bytes = this.rom.bytes;
    const colors = this.rom.u16Array(paletteAt, 16);
    const tilesX = width / 8;
    for (let ty = 0; ty < height / 8; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tile = info.imageOffset + (ty * tilesX + tx) * 32;
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            const b = bytes[tile + py * 4 + (px >> 1)]!;
            const index = px & 1 ? b >> 4 : b & 0xf;
            if (index !== 0) writeBgr555(image.data, (ty * 8 + py) * width + tx * 8 + px, colors[index]!);
          }
        }
      }
    }
    return image;
  }
}
