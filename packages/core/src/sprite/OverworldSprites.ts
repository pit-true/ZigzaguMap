import type { PaletteTint } from "../dns/DnsTint.js";
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
  readonly paletteSlot: number;
  readonly shadowSize: number;
  readonly width: number;
  readonly height: number;
  /** 1 コマ目（下向きの立ち姿）の画像データの位置。 */
  readonly imageOffset: number;
  readonly framesOffset: number;
  readonly animationsOffset: number | null;
}

export interface OverworldFrame {
  readonly index: number;
  readonly hFlip: boolean;
  readonly vFlip: boolean;
}

export type OverworldAnimationCommand =
  | { readonly kind: "frame"; readonly frame: OverworldFrame; readonly duration: number }
  | { readonly kind: "jump"; readonly target: number }
  | { readonly kind: "loop"; readonly count: number }
  | { readonly kind: "end" };

export interface WalkingOffsets {
  readonly stopLeft: number;
  readonly stopRight: number;
  readonly walkLeft: number;
  readonly walkRight: number;
}

/**
 * OW（人などのスプライト）の表。画像番号から 1 コマ目（下向き）の画像を作る。
 * 画像は 4bpp のタイルを横に並べたもの（無圧縮）で、パレットの 0 番は透明。作った画像は覚えておく。
 */
export class OverworldSprites {
  private readonly infos = new Map<number, OverworldGraphicsInfo | null>();
  private readonly images = new Map<number, RgbaImage | null>();
  private palettes: Map<number, number> | null = null;
  private walking: Map<number, WalkingOffsets> | null | undefined;
  private readonly animationCommands = new Map<string, OverworldAnimationCommand | null>();

  private constructor(
    private readonly rom: Rom,
    /** 画像情報の表の位置。 */
    readonly graphicsTable: number,
    /** パレット表の位置。 */
    readonly paletteTable: number,
    private readonly walkingTablePointer?: number,
  ) {}

  /** 表へのポインタが置かれている位置から読む。 */
  static read(rom: Rom, graphicsTablePointer: number, paletteTablePointer: number, walkingTablePointer?: number): OverworldSprites {
    return new OverworldSprites(rom, rom.pointer(graphicsTablePointer), rom.pointer(paletteTablePointer), walkingTablePointer);
  }

  /** nullは対応表に無い絵、undefinedは表自体を読めない場合。 */
  walkingOffsets(graphicsId: number): WalkingOffsets | null | undefined {
    if (this.walking === undefined) {
      this.walking = null;
      try {
        if (this.walkingTablePointer !== undefined) {
          const start = this.rom.pointer(this.walkingTablePointer);
          const table = new Map<number, WalkingOffsets>();
          for (let i = 0; i < 64; i++) {
            const at = start + i * 8;
            const pointer = this.rom.u32(at);
            if (!pointer) { this.walking = table; break; }
            if (!this.rom.isPointer(pointer)) break;
            table.set(pointer - ROM_BASE, {
              stopLeft: this.rom.u8(at + 4), stopRight: this.rom.u8(at + 5),
              walkLeft: this.rom.u8(at + 6), walkRight: this.rom.u8(at + 7),
            });
          }
        }
      } catch { /* 壊れた表は、標準の値と決め付けない。 */ }
    }
    const info = this.info(graphicsId);
    if (!this.walking || info?.animationsOffset == null) return undefined;
    return this.walking.get(info.animationsOffset) ?? null;
  }

  /** 4バイトのアニメーション命令。コマの参照先も範囲を確かめる。 */
  animationCommand(graphicsId: number, animation: number, command: number): OverworldAnimationCommand | null {
    if (!Number.isInteger(animation) || animation < 0 || animation >= 64 || !Number.isInteger(command) || command < 0 || command >= 256) return null;
    const key = `${graphicsId}:${animation}:${command}`;
    if (this.animationCommands.has(key)) return this.animationCommands.get(key)!;
    let result: OverworldAnimationCommand | null = null;
    const info = this.info(graphicsId);
    try {
      if (info?.animationsOffset != null) {
        const start = this.rom.pointer(info.animationsOffset + animation * 4);
        const at = start + command * 4;
        const raw = this.rom.u16(at), arg = this.rom.u16(at + 2);
        if (raw === 0xffff) result = { kind: "end" };
        else if (raw === 0xfffe) result = { kind: "jump", target: arg & 63 };
        else if (raw === 0xfffd) result = { kind: "loop", count: arg & 63 };
        else if (raw < 256) {
          const entry = info.framesOffset + raw * FRAME_SIZE;
          const offset = this.rom.pointer(entry);
          const size = info.width * info.height / 2;
          if (this.rom.u16(entry + 4) >= size && this.rom.inRange(offset, size)) {
            result = { kind: "frame", frame: { index: raw, hFlip: !!(arg & 64), vFlip: !!(arg & 128) }, duration: arg & 63 };
          }
        }
      }
    } catch { /* 範囲外のポインタは表示しない。 */ }
    this.animationCommands.set(key, result);
    if (this.animationCommands.size > 4096) this.animationCommands.delete(this.animationCommands.keys().next().value!);
    return result;
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
        if (valid && rom.inRange(imageOffset, (width * height) / 2)) out = {
          paletteTag: rom.u16(at + 2), paletteSlot: rom.u8(at + 12) & 15, shadowSize: (rom.u8(at + 12) >> 4) & 3, width, height, imageOffset,
          framesOffset: frames,
          animationsOffset: rom.isPointer(rom.u32(at + 0x18)) ? rom.pointer(at + 0x18) : null,
        };
      }
    } catch {
      out = null;
    }
    this.infos.set(graphicsId, out);
    return out;
  }

  /** 1 コマ目（下向き）の画像（RGBA、パレット 0 番は透明）。読めなければ null。 */
  image(graphicsId: number, tint: PaletteTint | null = null): RgbaImage | null {
    if (tint) {
      const info = this.info(graphicsId);
      const palette = info ? this.paletteOffset(info.paletteTag) : null;
      return info && palette !== null ? this.decode(info, palette, tint) : null;
    }
    const cached = this.images.get(graphicsId);
    if (cached !== undefined) return cached;
    const info = this.info(graphicsId);
    const palette = info ? this.paletteOffset(info.paletteTag) : null;
    const out = info && palette !== null ? this.decode(info, palette) : null;
    this.images.set(graphicsId, out);
    return out;
  }

  /** ROM のアニメーション命令をたどる。終了後は最後のコマを保ち、不正な参照は null。 */
  animationFrame(graphicsId: number, animation: number, elapsed: number): OverworldFrame | null {
    if (!Number.isInteger(animation) || animation < 0 || animation >= 64 || !Number.isSafeInteger(elapsed) || elapsed < 0) return null;
    try {
      let command = 0, count = 0, time = 0;
      let last: OverworldFrame | null = null;
      const visited = new Map<string, number>();
      for (let steps = 0; steps < 4096; steps++) {
        if (command < 0 || command >= 256) return null;
        const key = `${command}:${count}`;
        const previous = visited.get(key);
        if (previous !== undefined) {
          const period = time - previous;
          if (period <= 0) return null;
          time += Math.floor((elapsed - time) / period) * period;
          visited.clear();
        }
        visited.set(key, time);
        const item = this.animationCommand(graphicsId, animation, command);
        if (!item) return null;
        if (item.kind === "end") return last;
        if (item.kind === "jump") { command = item.target; continue; }
        if (item.kind === "loop") {
          count = count ? count - 1 : item.count;
          if (count) {
            // actanm.c: anm_count_back — 直前の LOOP の次、または先頭へ戻る。
            do { command--; } while (command > 0 && this.animationCommand(graphicsId, animation, command - 1)?.kind !== "loop");
          } else command++;
          continue;
        }
        last = item.frame;
        const duration = Math.max(1, item.duration);
        if (elapsed < time + duration) return last;
        time += duration;
        command++;
      }
    } catch { /* 範囲外のポインタ・命令は表示しない。 */ }
    return null;
  }

  /** 指定コマの画像。左右・上下反転は ROM の命令に従う。既定の画像を変更しない。 */
  frameImage(graphicsId: number, frame: OverworldFrame, tint: PaletteTint | null = null): RgbaImage | null {
    if (!Number.isInteger(frame.index) || frame.index < 0 || frame.index >= 256) return null;
    const info = this.info(graphicsId);
    if (!info) return null;
    if (frame.index === 0 && !frame.hFlip && !frame.vFlip) return this.image(graphicsId, tint);
    try {
      const at = info.framesOffset + frame.index * FRAME_SIZE;
      const imageOffset = this.rom.pointer(at);
      const bytes = info.width * info.height / 2;
      if (this.rom.u16(at + 4) < bytes || !this.rom.inRange(imageOffset, bytes)) return null;
      const palette = this.paletteOffset(info.paletteTag);
      if (palette === null) return null;
      const image = this.decode({ ...info, imageOffset }, palette, tint);
      if (!frame.hFlip && !frame.vFlip) return image;
      const out = createImage(image.width, image.height);
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const src = ((frame.vFlip ? image.height - 1 - y : y) * image.width + (frame.hFlip ? image.width - 1 - x : x)) * 4;
        out.data.set(image.data.subarray(src, src + 4), (y * image.width + x) * 4);
      }
      return out;
    } catch { return null; }
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

  private decode(info: OverworldGraphicsInfo, paletteAt: number, tint: PaletteTint | null = null): RgbaImage {
    const raw = this.rom.u16Array(paletteAt, 16);
    const colors = tint ? tint(raw, info.paletteSlot) : raw;
    return decodeObjectImage(this.rom, info.width, info.height, info.imageOffset, colors);
  }
}

/** OBJの無圧縮4bpp画像。OWとフィールドエフェクトで同じ並びを使う。 */
export function decodeObjectImage(rom: Rom, width: number, height: number, imageOffset: number, colors: ArrayLike<number>): RgbaImage {
  rom.check(imageOffset, width * height / 2);
  const image = createImage(width, height);
  const bytes = rom.bytes;
  const tilesX = width / 8;
  for (let ty = 0; ty < height / 8; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = imageOffset + (ty * tilesX + tx) * 32;
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
