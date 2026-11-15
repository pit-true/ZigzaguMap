import { EditError, EditErrorCode } from "../command/EditError.js";
import { bgr555ToRgb, rgbToBgr555 } from "./blockFormat.js";

/** AdvanceMap のパレットファイル（.pal）のバイト数（16 色 × `R, G, B, 0`）。 */
export const PALETTE_FILE_BYTES = 64;

/** 読めるパレットの形式（#396）。 */
export type PaletteFormat = "am" | "jasc" | "gimp" | "act";

/** Adobe の .act のバイト数（256 色 × RGB。後ろに色の数と透明の番号の 4 バイトが付くこともある）。 */
const ACT_BYTES = 768;

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

  /**
   * パレットファイルを形式を見分けて読む（#396）。先頭が `JASC-PAL` なら JASC-PAL、`GIMP Palette` なら GIMP の .gpl、
   * 768 バイトか 772 バイトなら Adobe の .act、ほかは AdvanceMap の .pal（64 バイト）として読む。
   * 16 色でなければ EditError（invalidPaletteFile。`format` と、読めた色の数 `colors` か、.pal ならバイト数 `length`）。
   * .act は、後ろの 4 バイトがあれば色の数をそこから読み、無ければ 17 色目からがどれも黒のときに 16 色とみなす。
   */
  static readAny(bytes: Uint8Array): { format: PaletteFormat; colors: number[] } {
    const head = latin1(bytes.subarray(0, 16));
    if (head.startsWith("JASC-PAL")) return { format: "jasc", colors: sixteen("jasc", readJasc(latin1(bytes))) };
    if (head.startsWith("GIMP Palette")) return { format: "gimp", colors: sixteen("gimp", readGimp(latin1(bytes))) };
    if (bytes.length === ACT_BYTES || bytes.length === ACT_BYTES + 4) return { format: "act", colors: sixteen("act", readAct(bytes)) };
    return { format: "am", colors: PaletteFile.read(bytes) };
  }
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function sixteen(format: PaletteFormat, rgb: readonly (readonly [number, number, number])[]): number[] {
  if (rgb.length !== 16) throw new EditError(EditErrorCode.InvalidPaletteFile, { format, colors: rgb.length });
  return rgb.map(([r, g, b]) => rgbToBgr555(r, g, b));
}

function channel(text: string | undefined): number | null {
  if (text === undefined || !/^\d{1,3}$/.test(text)) return null;
  const n = Number(text);
  return n <= 255 ? n : null;
}

/** JASC-PAL: 1 行目 `JASC-PAL`、2 行目 `0100`、3 行目 色の数、続いて `R G B` の行。 */
function readJasc(text: string): [number, number, number][] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const count = Number(lines[2]);
  const out: [number, number, number][] = [];
  for (const line of lines.slice(3)) {
    if (line === "") continue;
    const [r, g, b] = line.split(/\s+/).map(channel);
    if (r == null || g == null || b == null) throw new EditError(EditErrorCode.InvalidPaletteFile, { format: "jasc", colors: out.length });
    out.push([r, g, b]);
  }
  // 3 行目の数と行の数が違うときは、少ないほうを色の数として 16 色かを見る
  return Number.isInteger(count) && count < out.length ? out.slice(0, count) : out;
}

/** GIMP の .gpl: 1 行目 `GIMP Palette`、`Name:`・`Columns:`・`#` の行は飛ばし、`R G B 名前` の行。 */
function readGimp(text: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const raw of text.split(/\r?\n/).slice(1)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || /^(Name|Columns):/i.test(line)) continue;
    const [r, g, b] = line.split(/\s+/).slice(0, 3).map(channel);
    if (r == null || g == null || b == null) throw new EditError(EditErrorCode.InvalidPaletteFile, { format: "gimp", colors: out.length });
    out.push([r, g, b]);
  }
  return out;
}

/** Adobe の .act: 256 色の RGB。772 バイトなら後ろの 4 バイトの先頭 2 バイト（ビッグエンディアン）が色の数。 */
function readAct(bytes: Uint8Array): [number, number, number][] {
  let count = 256;
  if (bytes.length === ACT_BYTES + 4) {
    count = Math.min(256, (bytes[ACT_BYTES]! << 8) | bytes[ACT_BYTES + 1]!);
  } else {
    // 色の数が無い .act は、後ろの黒を除いた数（16 色より短ければ 16 色とみなす）
    let last = 255;
    while (last >= 0 && bytes[last * 3] === 0 && bytes[last * 3 + 1] === 0 && bytes[last * 3 + 2] === 0) last--;
    count = last < 16 ? 16 : last + 1;
  }
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) out.push([bytes[i * 3]!, bytes[i * 3 + 1]!, bytes[i * 3 + 2]!]);
  return out;
}
