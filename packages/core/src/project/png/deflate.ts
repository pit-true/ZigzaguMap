/**
 * zlib 形式の圧縮（固定ハフマン符号 + LZ77）。PNG の書き出し用の小さな実装で、圧縮率より単純さを優先する。
 * 展開は inflate.ts（または node:zlib）で読めること。
 */

/** 圧縮関数（PNG の書き出しで差し替えられる）。 */
export type DeflateFunction = (data: Uint8Array) => Uint8Array;

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 64;

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

class BitWriter {
  private readonly bytes: number[] = [];
  private bit = 0;
  private current = 0;

  /** 下位ビットから書く（DEFLATE の通常のビット順）。 */
  write(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.current |= ((value >>> i) & 1) << this.bit;
      if (++this.bit === 8) this.flush();
    }
  }

  /** ハフマン符号（上位ビットから書く）。 */
  writeCode(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.write((code >>> i) & 1, 1);
  }

  finish(): number[] {
    if (this.bit > 0) this.flush();
    return this.bytes;
  }

  private flush(): void {
    this.bytes.push(this.current);
    this.current = 0;
    this.bit = 0;
  }
}

function writeLiteral(out: BitWriter, symbol: number): void {
  if (symbol < 144) out.writeCode(0x30 + symbol, 8);
  else if (symbol < 256) out.writeCode(0x190 + symbol - 144, 9);
  else if (symbol < 280) out.writeCode(symbol - 256, 7);
  else out.writeCode(0xc0 + symbol - 280, 8);
}

function writeMatch(out: BitWriter, length: number, distance: number): void {
  let li = LENGTH_BASE.length - 1;
  while (LENGTH_BASE[li]! > length) li--;
  writeLiteral(out, 257 + li);
  out.write(length - LENGTH_BASE[li]!, LENGTH_EXTRA[li]!);
  let di = DIST_BASE.length - 1;
  while (DIST_BASE[di]! > distance) di--;
  out.writeCode(di, 5);
  out.write(distance - DIST_BASE[di]!, DIST_EXTRA[di]!);
}

/** zlib 形式に圧縮する。 */
export function deflateZlib(data: Uint8Array): Uint8Array {
  const out = new BitWriter();
  out.write(1, 1); // 最後のブロック
  out.write(1, 2); // 固定ハフマン
  const head = new Int32Array(1 << 15).fill(-1);
  const prev = new Int32Array(data.length);
  const hash = (i: number) => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & 0x7fff;
  const insert = (i: number) => {
    if (i + MIN_MATCH > data.length) return;
    const h = hash(i);
    prev[i] = head[h]!;
    head[h] = i;
  };
  let i = 0;
  while (i < data.length) {
    let bestLength = 0;
    let bestDistance = 0;
    if (i + MIN_MATCH <= data.length) {
      let candidate = head[hash(i)]!;
      let chain = 0;
      while (candidate >= 0 && i - candidate <= WINDOW && chain++ < MAX_CHAIN) {
        let length = 0;
        const max = Math.min(MAX_MATCH, data.length - i);
        while (length < max && data[candidate + length] === data[i + length]) length++;
        if (length > bestLength) {
          bestLength = length;
          bestDistance = i - candidate;
          if (length === max) break;
        }
        candidate = prev[candidate]!;
      }
    }
    if (bestLength >= MIN_MATCH) {
      writeMatch(out, bestLength, bestDistance);
      for (let k = 0; k < bestLength; k++) insert(i + k);
      i += bestLength;
    } else {
      writeLiteral(out, data[i]!);
      insert(i);
      i++;
    }
  }
  writeLiteral(out, 256);
  const body = out.finish();
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  return Uint8Array.from([0x78, 0x01, ...body, adler >>> 24, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff]);
}
