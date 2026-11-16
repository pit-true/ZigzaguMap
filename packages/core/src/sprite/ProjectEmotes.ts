import type { ProjectFs } from "../project/ProjectFs.js";
import { decodeIndexedPng, type IndexedImage } from "../project/png/PngDecoder.js";
import type { PaletteTint } from "../dns/DnsTint.js";
import { createImage, writeBgr555, type RgbaImage } from "../render/color.js";

const NAMES = ["exclaim", "question", "ellipsis", "double_exclaim", "music", "mon_exclaim", "mon_question", "mon_ellipsis", "mon_music", "mon_heart", "mon_poison", "mon_happy", "mon_very_happy", "mon_sad", "mon_upset", "mon_angry"];

/** src/emotes.cの既知の画像配置。人用5枚・ポケモン用11組、色は両方MonPalを使う。 */
export class ProjectEmotes {
  constructor(private readonly human: IndexedImage, private readonly mon: IndexedImage) {
    if (human.width !== 16 || human.height !== 80 || mon.width !== 16 || mon.height !== 352 || mon.palette.length < 48) throw new RangeError("Unknown emote image layout");
  }
  static async read(fs: ProjectFs): Promise<ProjectEmotes | null> {
    const sourcePath = "src/emotes.c", headerPath = "include/new/emotes.h";
    if (!await fs.exists(sourcePath) || !await fs.exists(headerPath)) return null;
    try {
      const source = (await fs.readText(sourcePath)).replace(/\s+/g, ""), header = await fs.readText(headerPath);
      if (!source.includes("#defineHUMAN_EMOTES5") || !source.includes("#defineMON_FIRST_FRAMES24") || !/#define\s+EMOTE_FRAMES\s+60\b/.test(header)) return null;
      const human = decodeIndexedPng(await fs.readBytes("graphics/Emotes/gEmoteHuman.png"), fs.inflate);
      const mon = decodeIndexedPng(await fs.readBytes("graphics/Emotes/gEmoteMon.png"), fs.inflate);
      return new ProjectEmotes(human, mon);
    } catch { return null; }
  }
  frame(name: string, elapsed: number, tint: PaletteTint | null = null): RgbaImage | null {
    const index = NAMES.indexOf(name.replace(/^emote_/, ""));
    if (index < 0 || !Number.isInteger(elapsed) || elapsed < 0 || elapsed >= 60) return null;
    const source = index < 5 ? this.human : this.mon;
    const frame = index < 5 ? index : (index - 5) * 2 + (elapsed >= 24 ? 1 : 0);
    let colors: ArrayLike<number> = Uint16Array.from({ length: 16 }, (_, i) => (this.mon.palette[i * 3]! >> 3) | ((this.mon.palette[i * 3 + 1]! >> 3) << 5) | ((this.mon.palette[i * 3 + 2]! >> 3) << 10));
    if (tint) {
      // 動的なOBJパレットの番号はRAMで割り当てられる。全slotが同じ結果の時だけ色を確定する。
      const first = tint(colors, 0);
      for (let slot = 1; slot < 16; slot++) {
        const other = tint(colors, slot);
        if (Array.from(first).some((value, i) => value !== other[i])) return null;
      }
      colors = first;
    }
    const image = createImage(16, 16);
    for (let i = 0; i < 256; i++) {
      const color = source.pixels[frame * 256 + i]!;
      if (color > 15) return null;
      if (color) writeBgr555(image.data, i, colors[color]!);
    }
    return image;
  }
}
