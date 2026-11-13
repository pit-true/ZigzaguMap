import { DataError } from "../binary/DataError.js";
import { bytesEqual, formatHexBytes } from "../binary/bytes.js";
import { CharmapTable, type CharmapEntry } from "./CharmapTable.js";
import { ND_CHARMAP_TBL } from "./charmapNd.js";

/** 漢字パッチの 2 バイト文字（FC xx yy）の先頭。 */
const KANJI_PREFIX = 0xfc;
/** 漢字パッチの 2 バイト文字の、先頭の後ろのバイト数。 */
const KANJI_TAIL_BYTES = 2;

/**
 * ゲーム内の文字列と JavaScript の文字列の相互変換。文字コード表は charmap.tbl の形式で受け取る。
 *
 * - 複数バイトの定義（`FC 88 9F=亜` など）は、長いバイト列から優先して当てる。
 * - 表に無いバイトは `[F7]` のように 16 進のエスケープにして、encode で元に戻せるようにする。
 *   表に無い FC xx yy は `[FC889F]` のように 3 バイトまとめてエスケープする。
 * - 同じバイト列に複数の文字があるときは、encode で同じバイト列に戻る最初の文字を使う。
 *   どの文字でも戻らないバイト（別のバイトの定義と同じ文字だけのもの）はエスケープにする。
 */
export class TextCodec {
  /** 文字 → バイト（最初の定義）。 */
  private readonly reverse = new Map<string, Uint8Array>();
  /** 先頭のバイト → そのバイトで始まる定義（長い順。同じ長さはファイルの順）。 */
  private readonly byFirst = new Map<number, CharmapEntry[]>();
  private readonly maxTextLength: number;
  /** 終端のバイト。 */
  readonly terminator: number;

  /**
   * `table` は charmap.tbl を読んだ表か、1 バイト文字の表（添字 = バイト、null は表に無い）。
   * `aliases` は書くときだけ受け付ける別表記。
   */
  constructor(table: CharmapTable | readonly (string | null)[], aliases: Readonly<Record<string, number>> = {}) {
    const charmap =
      table instanceof CharmapTable
        ? table
        : new CharmapTable(table.flatMap((c, code) => (c === null ? [] : [{ bytes: Uint8Array.of(code), text: c }])));
    this.terminator = charmap.terminator;
    for (const e of charmap.entries) if (!this.reverse.has(e.text)) this.reverse.set(e.text, e.bytes);
    for (const [c, code] of Object.entries(aliases)) if (!this.reverse.has(c)) this.reverse.set(c, Uint8Array.of(code));
    for (const e of charmap.entries) {
      // encode で同じバイト列に戻らない文字は decode に使わない。
      if (!bytesEqual(this.reverse.get(e.text)!, e.bytes)) continue;
      const first = e.bytes[0]!;
      let list = this.byFirst.get(first);
      if (!list) this.byFirst.set(first, (list = []));
      list.push(e);
    }
    for (const list of this.byFirst.values()) list.sort((a, b) => b.bytes.length - a.bytes.length);
    let max = 1;
    for (const text of this.reverse.keys()) max = Math.max(max, [...text].length);
    this.maxTextLength = max;
  }

  /** charmap.tbl の文字列から作る。 */
  static fromCharmap(text: string): TextCodec {
    return new TextCodec(CharmapTable.parse(text));
  }

  /** 同梱の文字コード表（NeoDark-CFRU の charmap.tbl）を使う変換器。 */
  static readonly japanese = TextCodec.fromCharmap(ND_CHARMAP_TBL);

  /** `offset` から終端の手前までを文字列にする。終端が無ければ末尾まで。 */
  decode(bytes: Uint8Array, offset = 0): string {
    let end = offset;
    while (end < bytes.length && bytes[end] !== this.terminator) end++;
    const body = bytes.subarray(offset, end);
    const text = this.decodeBody(body, true);
    // 隣り合う文字がつながって別の定義になるなど、元に戻らないときは全部エスケープにする。
    const back = this.tryEncode(text, false);
    return back && bytesEqual(back, body) ? text : this.decodeBody(body, false);
  }

  private decodeBody(body: Uint8Array, useTable: boolean): string {
    let out = "";
    let at = 0;
    while (at < body.length) {
      const code = body[at]!;
      if (useTable) {
        const hit = this.byFirst.get(code)?.find((e) => matchesAt(body, at, e.bytes));
        if (hit) {
          out += hit.text;
          at += hit.bytes.length;
          continue;
        }
      }
      if (code === KANJI_PREFIX) {
        const end = Math.min(body.length, at + 1 + KANJI_TAIL_BYTES);
        out += escape(body.subarray(at, end));
        at = end;
        continue;
      }
      out += escape(body.subarray(at, at + 1));
      at++;
    }
    return out;
  }

  /** 文字列をバイト列にする（終端を付ける）。使えない文字があれば DataError。 */
  encode(text: string, withTerminator = true): Uint8Array {
    const out: number[] = [];
    const chars = [...text];
    let i = 0;
    while (i < chars.length) {
      const c = chars[i]!;
      if (c === "[") {
        const close = chars.indexOf("]", i);
        const hex = close < 0 ? "" : chars.slice(i + 1, close).join("");
        if (/^(?:[0-9A-Fa-f]{2})+$/.test(hex)) {
          for (let h = 0; h < hex.length; h += 2) out.push(parseInt(hex.slice(h, h + 2), 16));
          i = close + 1;
          continue;
        }
      }
      let matched = false;
      for (let len = Math.min(this.maxTextLength, chars.length - i); len >= 1; len--) {
        const bytes = this.reverse.get(chars.slice(i, i + len).join(""));
        if (bytes) {
          out.push(...bytes);
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) throw new DataError(`使えない文字です: ${JSON.stringify(c)}`);
    }
    if (withTerminator) out.push(this.terminator);
    return Uint8Array.from(out);
  }

  /** 文字列が変換できるか。 */
  canEncode(text: string): boolean {
    return this.tryEncode(text) !== null;
  }

  /** 変換できない最初の文字。すべて変換できれば null。 */
  firstInvalidChar(text: string): string | null {
    try {
      this.encode(text);
      return null;
    } catch (e) {
      const m = e instanceof DataError ? /使えない文字です: (".*")$/.exec(e.message) : null;
      return m ? (JSON.parse(m[1]!) as string) : "[";
    }
  }

  private tryEncode(text: string, withTerminator = true): Uint8Array | null {
    try {
      return this.encode(text, withTerminator);
    } catch {
      return null;
    }
  }
}

function matchesAt(bytes: Uint8Array, at: number, pattern: Uint8Array): boolean {
  if (at + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i++) if (bytes[at + i] !== pattern[i]) return false;
  return true;
}

function escape(bytes: Uint8Array): string {
  return `[${formatHexBytes(bytes)}]`;
}
