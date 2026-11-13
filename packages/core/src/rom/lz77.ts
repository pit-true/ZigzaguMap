import { RomError } from "./RomError.js";

/** LZ77 圧縮データ（GBA BIOS の 0x10 形式）を展開する。`offset` は先頭のヘッダー位置。 */
export function decompressLz77(src: Uint8Array, offset: number): Uint8Array {
  if (offset < 0 || offset + 4 > src.length) {
    throw new RomError(`LZ77: ヘッダーが範囲外です (0x${offset.toString(16)})`);
  }
  if (src[offset] !== 0x10) {
    throw new RomError(`LZ77: 圧縮形式ではありません (0x${offset.toString(16)})`);
  }
  const size = src[offset + 1]! | (src[offset + 2]! << 8) | (src[offset + 3]! << 16);
  const out = new Uint8Array(size);
  let pos = offset + 4;
  let written = 0;
  while (written < size) {
    if (pos >= src.length) throw new RomError("LZ77: データが途中で切れています");
    const flags = src[pos++]!;
    for (let bit = 7; bit >= 0 && written < size; bit--) {
      if ((flags >> bit) & 1) {
        if (pos + 1 >= src.length) throw new RomError("LZ77: データが途中で切れています");
        const b1 = src[pos++]!;
        const b2 = src[pos++]!;
        const length = (b1 >> 4) + 3;
        const distance = (((b1 & 0x0f) << 8) | b2) + 1;
        if (distance > written) throw new RomError("LZ77: 参照位置が不正です");
        for (let i = 0; i < length && written < size; i++) {
          out[written] = out[written - distance]!;
          written++;
        }
      } else {
        if (pos >= src.length) throw new RomError("LZ77: データが途中で切れています");
        out[written++] = src[pos++]!;
      }
    }
  }
  return out;
}

/** 指定位置が LZ77 圧縮データの先頭らしいか（ヘッダーだけで判定）。 */
export function looksLikeLz77(src: Uint8Array, offset: number): boolean {
  if (offset < 0 || offset + 4 > src.length || src[offset] !== 0x10) return false;
  const size = src[offset + 1]! | (src[offset + 2]! << 8) | (src[offset + 3]! << 16);
  return size > 0;
}
