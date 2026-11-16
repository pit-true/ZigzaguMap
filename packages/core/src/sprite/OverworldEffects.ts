import type { Rom } from "../rom/Rom.js";
import type { RgbaImage } from "../render/color.js";
import type { PaletteTint } from "../dns/DnsTint.js";
import { decodeObjectImage, type OverworldSprites } from "./OverworldSprites.js";

/** ROMのフィールドエフェクト表。表が読めなければ代わりの絵を作らずnullを返す。 */
export class OverworldEffects {
  private constructor(private readonly rom: Rom, private readonly table: number, private readonly sprites: OverworldSprites) {}

  static read(rom: Rom, tablePointer: number, sprites: OverworldSprites): OverworldEffects {
    return new OverworldEffects(rom, rom.pointer(tablePointer), sprites);
  }

  /** evobjdat.cの先頭4件は8×8、16×8、32×8、64×32の影。パレットはOBJ0。 */
  shadow(graphicsId: number, playerGraphicsId = 0, tint: PaletteTint | null = null): RgbaImage | null {
    const info = this.sprites.info(graphicsId);
    const player = this.sprites.info(playerGraphicsId);
    if (!info || !player) return null;
    const palette = this.sprites.paletteOffset(player.paletteTag);
    if (palette === null) return null;
    try {
      const header = this.rom.pointer(this.table + info.shadowSize * 4);
      if (this.rom.u16(header) !== 0xffff) return null;
      const frames = this.rom.pointer(header + 12);
      const imageOffset = this.rom.pointer(frames);
      const oam = this.rom.pointer(header + 4);
      const shape = this.rom.u16(oam) >>> 14;
      const size = this.rom.u16(oam + 2) >>> 14;
      const dimensions = [
        [[8, 8], [16, 16], [32, 32], [64, 64]],
        [[16, 8], [32, 8], [32, 16], [64, 32]],
        [[8, 16], [8, 32], [16, 32], [32, 64]],
      ][shape]?.[size];
      if (!dimensions) return null;
      const [width, height] = dimensions as [number, number];
      if (this.rom.u16(frames + 4) < width * height / 2) return null;
      const colors = this.rom.u16Array(palette, 16);
      return decodeObjectImage(this.rom, width, height, imageOffset, tint ? tint(colors, 0) : colors);
    } catch { return null; }
  }
}
