import type { Rom } from "../rom/Rom.js";
import { TextCodec } from "./TextCodec.js";
import { JP_TERMINATOR } from "./charsetJapanese.js";

/** 日本語版の種族名 1 件のバイト数（5 文字 + 終端）。 */
export const SPECIES_NAME_BYTES = 6;
/** 素の FR の種族の数（0 番の「?????」を含む）。 */
export const SPECIES_COUNT = 412;

/**
 * 種族名表（gSpeciesNames）。日本語版は 1 件 6 バイトで並ぶ。
 * CFRU で増やした ROM でも表の長さは分からないので、範囲は呼ぶ側の番号で決め、読めなければ null を返す。
 */
export class SpeciesNameTable {
  private readonly cache = new Map<number, string | null>();

  private constructor(
    private readonly rom: Rom,
    /** 表の位置。 */
    readonly offset: number,
  ) {}

  /** 表へのポインタが置かれている位置から読む。 */
  static read(rom: Rom, tablePointerOffset: number): SpeciesNameTable {
    return new SpeciesNameTable(rom, rom.pointer(tablePointerOffset));
  }

  /** 種族名。ROM の外なら null。 */
  name(species: number, codec: TextCodec = TextCodec.japanese): string | null {
    if (!Number.isInteger(species) || species < 0) return null;
    const cached = this.cache.get(species);
    if (cached !== undefined) return cached;
    const at = this.offset + species * SPECIES_NAME_BYTES;
    let out: string | null = null;
    if (this.rom.inRange(at, SPECIES_NAME_BYTES)) {
      const end = this.rom.bytes.subarray(at, at + SPECIES_NAME_BYTES).indexOf(JP_TERMINATOR);
      // 終端が無い（6 バイトを使い切った）名前はそこで切る。
      out = codec.decode(this.rom.slice(at, end < 0 ? SPECIES_NAME_BYTES : end + 1));
    }
    this.cache.set(species, out);
    return out;
  }
}
