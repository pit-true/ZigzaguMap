import { EditError, EditErrorCode } from "../command/EditError.js";
import { bgr555ToRgb, rgbToBgr555 } from "./blockFormat.js";

/** AdvanceMap のパレットファイル（.pal）のバイト数（16 色 × `R, G, B, 0`）。 */
export const PALETTE_FILE_BYTES = 64;

/**
 * AdvanceMap のパレットファイル（.pal、AM Tileset Palette）の読み書き。
 * 16 色を色 0 から順に `R, G, B, 0`（8 ビットに広げた値）で並べた 64 バイト。
 */
export class PaletteFile {
  /**
   * BGR555 の 16 色を .pal にする。`rejectDuplicates` を true にすると、同じ色が 2 つ以上あれば
   * EditError（duplicatePaletteColors。AdvanceMap が画像の書き出しで出す確認）。
   */
  static write(colors: ArrayLike<number>, rejectDuplicates = false): Uint8Array {
    const out = new Uint8Array(PALETTE_FILE_BYTES);
    const seen = new Set<number>();
    for (let i = 0; i < 16; i++) {
      const value = (colors[i] ?? 0) & 0x7fff;
      if (rejectDuplicates && seen.has(value)) throw new EditError(EditErrorCode.DuplicatePaletteColors, { color: i });
      seen.add(value);
      out.set(bgr555ToRgb(value), i * 4);
    }
    return out;
  }

  /** .pal を BGR555 の 16 色にする。64 バイトでなければ EditError（invalidPaletteFile）。 */
  static read(bytes: Uint8Array): number[] {
    if (bytes.length !== PALETTE_FILE_BYTES) throw new EditError(EditErrorCode.InvalidPaletteFile, { length: bytes.length });
    const colors: number[] = [];
    for (let i = 0; i < 16; i++) colors.push(rgbToBgr555(bytes[i * 4]!, bytes[i * 4 + 1]!, bytes[i * 4 + 2]!));
    return colors;
  }
}
