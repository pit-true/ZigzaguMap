import { DataError } from "../binary/DataError.js";
import { JP_ALIASES, JP_CHARSET, JP_TERMINATOR } from "./charsetJapanese.js";

/** 漢字パッチの 2 バイト文字（FC xx yy）の先頭。 */
const KANJI_PREFIX = 0xfc;
/** 漢字パッチの 2 バイト文字の、先頭の後ろのバイト数。 */
const KANJI_TAIL_BYTES = 2;

/**
 * ゲーム内の文字列と JavaScript の文字列の相互変換。
 * 表に無いバイトは `[F7]` のように 16 進のエスケープにして、encode で元に戻せるようにする。
 * FC xx yy（漢字パッチなど）は `[FC889F]` のように 3 バイトまとめてエスケープする。
 */
export class TextCodec {
  private readonly reverse = new Map<string, number>();

  constructor(
    private readonly table: readonly (string | null)[],
    aliases: Readonly<Record<string, number>> = {},
  ) {
    for (const [c, code] of Object.entries(aliases)) this.reverse.set(c, code);
    table.forEach((c, code) => {
      if (c !== null) this.reverse.set(c, code);
    });
  }

  /** 日本語版の文字コード表を使う変換器。 */
  static readonly japanese = new TextCodec(JP_CHARSET, JP_ALIASES);

  /** `offset` から終端（0xFF）の手前までを文字列にする。終端が無ければ末尾まで。 */
  decode(bytes: Uint8Array, offset = 0): string {
    let out = "";
    let at = offset;
    while (at < bytes.length && bytes[at] !== JP_TERMINATOR) {
      const code = bytes[at]!;
      if (code === KANJI_PREFIX) {
        let end = at + 1;
        while (end < bytes.length && end <= at + KANJI_TAIL_BYTES && bytes[end] !== JP_TERMINATOR) end++;
        out += escape(bytes.subarray(at, end));
        at = end;
        continue;
      }
      const c = this.table[code] ?? null;
      out += c ?? escape(bytes.subarray(at, at + 1));
      at++;
    }
    return out;
  }

  /** 文字列をバイト列にする（終端の 0xFF を付ける）。使えない文字があれば DataError。 */
  encode(text: string, withTerminator = true): Uint8Array {
    const out: number[] = [];
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]!;
      if (c === "[") {
        const close = chars.indexOf("]", i);
        const hex = close < 0 ? "" : chars.slice(i + 1, close).join("");
        if (!/^(?:[0-9A-Fa-f]{2})+$/.test(hex)) throw new DataError(`エスケープの書き方が不正です: 位置 ${i}`);
        for (let h = 0; h < hex.length; h += 2) out.push(parseInt(hex.slice(h, h + 2), 16));
        i = close;
        continue;
      }
      const code = this.reverse.get(c);
      if (code === undefined) throw new DataError(`使えない文字です: ${JSON.stringify(c)}`);
      out.push(code);
    }
    if (withTerminator) out.push(JP_TERMINATOR);
    return Uint8Array.from(out);
  }

  /** 文字列が変換できるか。 */
  canEncode(text: string): boolean {
    try {
      this.encode(text);
      return true;
    } catch {
      return false;
    }
  }
}

function escape(bytes: Uint8Array): string {
  let s = "[";
  for (const b of bytes) s += b.toString(16).toUpperCase().padStart(2, "0");
  return s + "]";
}
