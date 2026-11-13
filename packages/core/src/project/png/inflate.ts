import { DataError } from "../../binary/DataError.js";

/** zlib（RFC 1950）の展開関数の形。ProjectFs から差し替えられる。 */
export type InflateFunction = (data: Uint8Array) => Uint8Array;

/** 長さ符号 257〜285 の基準値と追加ビット数。 */
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
/** 距離符号 0〜29 の基準値と追加ビット数。 */
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
/** 符号長の符号の並び順。 */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** ハフマン符号表（符号長ごとの個数と、符号順の記号）。 */
interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function buildHuffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]!]!++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1]! + counts[i - 1]!;
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offsets[lengths[i]!]!++] = i;
  return { counts, symbols };
}

class BitReader {
  pos = 0;
  private bit = 0;
  private bits = 0;
  constructor(private readonly data: Uint8Array) {}

  need(n: number): number {
    while (this.bits < n) {
      if (this.pos >= this.data.length) throw new DataError("inflate: データが途中で切れています");
      this.bit |= this.data[this.pos++]! << this.bits;
      this.bits += 8;
    }
    const v = this.bit & ((1 << n) - 1);
    this.bit >>>= n;
    this.bits -= n;
    return v;
  }

  /** バイト境界にそろえる（格納ブロック用）。 */
  align(): void {
    this.bit = 0;
    this.bits = 0;
  }

  decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.need(1);
      const count = h.counts[len]!;
      if (code - count < first) return h.symbols[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new DataError("inflate: ハフマン符号が不正です");
  }
}

let fixedTables: { lit: Huffman; dist: Huffman } | null = null;
function fixed(): { lit: Huffman; dist: Huffman } {
  if (!fixedTables) {
    const lengths = new Uint8Array(288);
    lengths.fill(8, 0, 144);
    lengths.fill(9, 144, 256);
    lengths.fill(7, 256, 280);
    lengths.fill(8, 280, 288);
    fixedTables = { lit: buildHuffman(lengths), dist: buildHuffman(new Uint8Array(30).fill(5)) };
  }
  return fixedTables;
}

/** 生の deflate（RFC 1951）を展開する。 */
export function inflateRaw(data: Uint8Array): Uint8Array {
  const r = new BitReader(data);
  let out = new Uint8Array(Math.max(1024, data.length * 4));
  let size = 0;
  const ensure = (extra: number) => {
    if (size + extra <= out.length) return;
    let cap = out.length * 2;
    while (cap < size + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(out.subarray(0, size));
    out = next;
  };

  let last = 0;
  while (!last) {
    last = r.need(1);
    const type = r.need(2);
    if (type === 0) {
      r.align();
      if (r.pos + 4 > data.length) throw new DataError("inflate: 格納ブロックが途中で切れています");
      const len = data[r.pos]! | (data[r.pos + 1]! << 8);
      r.pos += 4;
      if (r.pos + len > data.length) throw new DataError("inflate: 格納ブロックが途中で切れています");
      ensure(len);
      out.set(data.subarray(r.pos, r.pos + len), size);
      size += len;
      r.pos += len;
      continue;
    }
    let lit: Huffman;
    let dist: Huffman;
    if (type === 1) {
      ({ lit, dist } = fixed());
    } else if (type === 2) {
      const hlit = r.need(5) + 257;
      const hdist = r.need(5) + 1;
      const hclen = r.need(4) + 4;
      const clens = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) clens[CODE_LENGTH_ORDER[i]!] = r.need(3);
      const clh = buildHuffman(clens);
      const lengths = new Uint8Array(hlit + hdist);
      for (let i = 0; i < lengths.length; ) {
        const sym = r.decode(clh);
        if (sym < 16) lengths[i++] = sym;
        else {
          let repeat: number;
          let value = 0;
          if (sym === 16) {
            if (i === 0) throw new DataError("inflate: 符号長の繰り返しが不正です");
            value = lengths[i - 1]!;
            repeat = 3 + r.need(2);
          } else if (sym === 17) repeat = 3 + r.need(3);
          else repeat = 11 + r.need(7);
          if (i + repeat > lengths.length) throw new DataError("inflate: 符号長が多すぎます");
          lengths.fill(value, i, i + repeat);
          i += repeat;
        }
      }
      lit = buildHuffman(lengths.subarray(0, hlit));
      dist = buildHuffman(lengths.subarray(hlit));
    } else {
      throw new DataError("inflate: 不正なブロックの種類です");
    }

    for (;;) {
      const sym = r.decode(lit);
      if (sym < 256) {
        ensure(1);
        out[size++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const li = sym - 257;
        if (li >= LENGTH_BASE.length) throw new DataError("inflate: 長さの符号が不正です");
        const length = LENGTH_BASE[li]! + r.need(LENGTH_EXTRA[li]!);
        const di = r.decode(dist);
        if (di >= DIST_BASE.length) throw new DataError("inflate: 距離の符号が不正です");
        const distance = DIST_BASE[di]! + r.need(DIST_EXTRA[di]!);
        if (distance > size) throw new DataError("inflate: 参照位置が不正です");
        ensure(length);
        for (let i = 0; i < length; i++, size++) out[size] = out[size - distance]!;
      }
    }
  }
  return out.slice(0, size);
}

/** zlib 形式（2 バイトのヘッダー + deflate + Adler-32）を展開する。Adler-32 は確かめない。 */
export function inflateZlib(data: Uint8Array): Uint8Array {
  if (data.length < 2) throw new DataError("zlib: データが短すぎます");
  const cmf = data[0]!;
  const flg = data[1]!;
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0) throw new DataError("zlib: ヘッダーが不正です");
  if (flg & 0x20) throw new DataError("zlib: 辞書つきの形式には対応していません");
  return inflateRaw(data.subarray(2));
}
