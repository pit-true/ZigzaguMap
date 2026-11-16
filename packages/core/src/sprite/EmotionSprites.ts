import type { Rom } from "../rom/Rom.js";
import type { PaletteTint } from "../dns/DnsTint.js";
import { createImage, type RgbaImage } from "../render/color.js";
import { decodeObjectImage, type OverworldAnimationCommand, type OverworldSprites } from "./OverworldSprites.js";
import { SpriteAnimation } from "./SpriteAnimation.js";

const ANIMATIONS: Readonly<Record<string, number>> = { exclaim: 0, doubleExclaim: 1, cross: 2, smile: 3, question: 4 };

/** ev_trai.cのGyoeActHeader。人物の絵の表とは独立したSpriteTemplateを読む。 */
export class EmotionSprites {
  private constructor(private readonly rom: Rom, private readonly header: number, private readonly sprites: OverworldSprites) {}
  static read(rom: Rom, pointer: number, sprites: OverworldSprites): EmotionSprites {
    return new EmotionSprites(rom, rom.pointer(pointer), sprites);
  }

  frame(mark: string, elapsed: number, playerGraphicsId = 0, tint: PaletteTint | null = null): RgbaImage | null {
    const animation = ANIMATIONS[mark];
    if (animation === undefined || !Number.isInteger(elapsed) || elapsed < 0 || elapsed >= 60) return null;
    const player = this.sprites.info(playerGraphicsId), palette = player ? this.sprites.paletteOffset(player.paletteTag) : null;
    if (palette === null) return null;
    try {
      const rom = this.rom, header = this.header;
      if (rom.u16(header) !== 0xffff) return null;
      const oam = rom.pointer(header + 4);
      if (rom.u16(oam) >>> 14 !== 0 || rom.u16(oam + 2) >>> 14 !== 1) return null;
      const frames = rom.pointer(header + 12), table = rom.pointer(header + 8);
      const clock = new SpriteAnimation((anim, command): OverworldAnimationCommand | null => {
        if (command < 0 || command >= 256) return null;
        const at = rom.pointer(table + anim * 4) + command * 4;
        const index = rom.u16(at), arg = rom.u16(at + 2);
        if (index === 0xffff) return { kind: "end" };
        if (index === 0xfffe) return { kind: "jump", target: arg & 63 };
        if (index === 0xfffd) return { kind: "loop", count: arg & 63 };
        if (index >= 256 || rom.u16(frames + index * 8 + 4) < 128) return null;
        rom.check(rom.pointer(frames + index * 8), 128);
        return { kind: "frame", frame: { index, hFlip: !!(arg & 64), vFlip: !!(arg & 128) }, duration: arg & 63 };
      }, animation);
      let frame = clock.tick();
      for (let f = 0; f < elapsed; f++) frame = clock.tick();
      if (!frame) return null;
      const raw = rom.u16Array(palette, 16);
      const decoded = decodeObjectImage(rom, 16, 16, rom.pointer(frames + frame.index * 8), tint ? tint(raw, 0) : raw);
      if (!frame.hFlip && !frame.vFlip) return decoded;
      const image = createImage(16, 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const from = ((frame.vFlip ? 15 - y : y) * 16 + (frame.hFlip ? 15 - x : x)) * 4;
        image.data.set(decoded.data.subarray(from, from + 4), (y * 16 + x) * 4);
      }
      return image;
    } catch { return null; }
  }
}

/** GyoeActMoveのwork[3]=-5、work[4]+=work[3]。11フレーム目で元の高さへ戻る。 */
export function emotionRise(frame: number): number {
  return [-5, -9, -12, -14, -15, -15, -14, -12, -9, -5, 0][frame] ?? 0;
}
