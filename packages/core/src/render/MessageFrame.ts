import type { Rom } from "../rom/Rom.js";
import { createImage, writeBgr555 } from "./color.js";

export type MessageFrameStyle = "vanilla" | "sign" | "chronos";

/** fld_bmp.cとChronosのmessage_box_frame.cの30×6タイル。実際のROMの絵と色を読む。 */
export function readMessageFrame(rom: Rom, tilesPointer: number, palettesPointer: number, style: MessageFrameStyle) {
  try {
    const tiles = rom.pointer(tilesPointer), palette = rom.pointer(palettesPointer) + (style === "sign" ? 64 : 0);
    rom.check(tiles, 20 * 32); rom.check(palette, 32);
    const image = createImage(240, 48);
    const colors = Array.from({ length: 16 }, (_, i) => rom.u16(palette + i * 2));
    // 文字部分はBGウィンドウ。背景色はパレット1番。
    for (let y = 8; y < 40; y++) for (let x = 16; x < 224; x++) writeBgr555(image.data, y * 240 + x, colors[1]!);
    const tile = (tx: number, ty: number, index: number, hFlip = false, vFlip = false): void => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const sx = hFlip ? 7 - x : x, sy = vFlip ? 7 - y : y;
        const packed = rom.u8(tiles + index * 32 + sy * 4 + (sx >> 1));
        const color = (packed >> ((sx & 1) * 4)) & 15;
        if (color) writeBgr555(image.data, (ty * 8 + y) * 240 + tx * 8 + x, colors[color]!);
      }
    };
    const left = [[0, 1], [3, 4], [5, 6], [5, 6], [7, 8], [9, 10]];
    const right = [12, 13, 14, 14, 15, 16];
    const sides = [[5, 6, 8, 9], [10, 11, 12, 13], [10, 11, 12, 13], [5, 6, 8, 9]];
    for (let row = 0; row < 6; row++) {
      if (style === "chronos") {
        tile(0, row, left[row]![0]!); tile(1, row, left[row]![1]!);
        tile(28, row, right[row]!); tile(29, row, left[row]![0]!, true);
        if (row === 0 || row === 5) for (let x = 2; x < 28; x++) tile(x, row, row === 0 ? 2 : 11);
      } else if (row === 0 || row === 5) {
        const flip = row === 5;
        tile(0, row, 0, false, flip); tile(1, row, 1, false, flip);
        for (let x = 2; x < 28; x++) tile(x, row, 2, false, flip);
        tile(28, row, 3, false, flip); tile(29, row, 4, false, flip);
      } else {
        const sourceRow = style === "sign" && row >= 3 ? row - 2 : row;
        const side = sides[sourceRow - 1]!;
        for (const [i, x] of [0, 1, 28, 29].entries()) tile(x, row, side[i]!, false, row >= 3);
      }
    }
    return { image, textColor: colors[2]!, shadowColor: colors[3]!, palette: colors };
  } catch { return null; }
}
