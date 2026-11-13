import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { TextCodec } from "./TextCodec.js";
import { JP_TERMINATOR } from "./charsetJapanese.js";

/** マップ名 ID の最初（地名番号 0x58 が表の 0 番目）。 */
export const MAP_NAME_FIRST_ID = 0x58;
/** マップ名 ID の数（0x58〜0xC4）。 */
export const MAP_NAME_COUNT = 109;
/** マップ名のバイト数の上限（終端を含む。Bochi と同じ）。 */
export const MAP_NAME_MAX_BYTES = 64;

/** 地名番号がマップ名表の範囲（0x58〜0xC4）か。 */
export function hasMapName(regionMapSectionId: number): boolean {
  const index = regionMapSectionId - MAP_NAME_FIRST_ID;
  return index >= 0 && index < MAP_NAME_COUNT;
}

/** FR 日本語版のマップ名表（地名番号 → 名前の文字列へのポインタ）。 */
export class MapNameTable {
  /** 表の位置。 */
  readonly offset: number;

  private constructor(
    private readonly rom: Rom,
    offset: number,
  ) {
    this.offset = offset;
  }

  /** 表へのポインタが置かれている位置から読む。 */
  static read(rom: Rom, tablePointerOffset: number): MapNameTable {
    const offset = rom.pointer(tablePointerOffset);
    rom.check(offset, MAP_NAME_COUNT * 4);
    return new MapNameTable(rom, offset);
  }

  /** 名前の元のバイト列（終端の 0xFF を含む）。範囲外の地名番号なら null。終端が無ければ RomError。 */
  rawName(regionMapSectionId: number): Uint8Array | null {
    if (!hasMapName(regionMapSectionId)) return null;
    const at = this.rom.pointer(this.offset + (regionMapSectionId - MAP_NAME_FIRST_ID) * 4);
    for (let length = 0; length < MAP_NAME_MAX_BYTES; length++) {
      if (!this.rom.inRange(at + length)) break;
      if (this.rom.bytes[at + length] === JP_TERMINATOR) return this.rom.slice(at, length + 1);
    }
    throw new RomError(`マップ名が終端しません (0x${(at + ROM_BASE).toString(16)})`);
  }

  /** 名前の文字列。範囲外の地名番号なら null。 */
  name(regionMapSectionId: number, codec: TextCodec = TextCodec.japanese): string | null {
    const raw = this.rawName(regionMapSectionId);
    return raw ? codec.decode(raw) : null;
  }
}
