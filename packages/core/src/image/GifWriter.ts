/**
 * GIF（GIF89a）の書き出し（Phase5 #403 のタイムラプス）。依存を増やさないために自分で書く。
 * - コマは 1 枚ずつ `addFrame` で足し、その場で 256 色に減らして LZW で縮める（全部のコマの画素を同時に持たない）。
 * - 色はコマごとの色表（ローカルカラーテーブル）。色が 256 以下ならそのまま、超えたら 6×7×6 の固定の色に寄せる。
 * - 透明は使わない（アルファは見ない）。最初のコマの前に NETSCAPE2.0 の繰り返しの指定を書く。
 */
export interface GifOptions {
  /** 繰り返しの回数（0 でずっと。既定 0）。 */
  readonly loop?: number;
}

/** 256 色に減らした 1 コマ。 */
export interface GifIndexedImage {
  /** 色表（RGB を 256 色分。使わない色は 0）。 */
  readonly palette: Uint8Array;
  /** 使っている色の数（1〜256）。 */
  readonly colors: number;
  /** 画素ごとの色の番号。 */
  readonly indices: Uint8Array;
}

const R_LEVELS = 6;
const G_LEVELS = 7;
const B_LEVELS = 6;

/** RGBA の画素を 256 色以下にする。色が 256 以下なら色は変わらない。 */
export function quantizeRgba(rgba: ArrayLike<number>, pixels: number): GifIndexedImage {
  const palette = new Uint8Array(256 * 3);
  const indices = new Uint8Array(pixels);
  const map = new Map<number, number>();
  let exact = true;
  for (let i = 0; i < pixels; i++) {
    const key = (rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!;
    let index = map.get(key);
    if (index === undefined) {
      if (map.size === 256) {
        exact = false;
        break;
      }
      index = map.size;
      map.set(key, index);
      palette[index * 3] = key >> 16;
      palette[index * 3 + 1] = (key >> 8) & 0xff;
      palette[index * 3 + 2] = key & 0xff;
    }
    indices[i] = index;
  }
  if (exact) return { palette, colors: Math.max(1, map.size), indices };
  // 色が多いときは、固定の 6×7×6（252 色）へ寄せる
  palette.fill(0);
  const level = (v: number, n: number): number => Math.round((v * (n - 1)) / 255);
  for (let r = 0; r < R_LEVELS; r++)
    for (let g = 0; g < G_LEVELS; g++)
      for (let b = 0; b < B_LEVELS; b++) {
        const i = (r * G_LEVELS + g) * B_LEVELS + b;
        palette[i * 3] = Math.round((r * 255) / (R_LEVELS - 1));
        palette[i * 3 + 1] = Math.round((g * 255) / (G_LEVELS - 1));
        palette[i * 3 + 2] = Math.round((b * 255) / (B_LEVELS - 1));
      }
  for (let i = 0; i < pixels; i++) {
    const r = level(rgba[i * 4]!, R_LEVELS);
    const g = level(rgba[i * 4 + 1]!, G_LEVELS);
    const b = level(rgba[i * 4 + 2]!, B_LEVELS);
    indices[i] = (r * G_LEVELS + g) * B_LEVELS + b;
  }
  return { palette, colors: R_LEVELS * G_LEVELS * B_LEVELS, indices };
}

/** 書きためるバイト列（足すたびに倍に広げる）。 */
class ByteBuffer {
  private data = new Uint8Array(1024);
  length = 0;

  byte(v: number): void {
    if (this.length === this.data.length) {
      const next = new Uint8Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v & 0xff;
  }

  u16(v: number): void {
    this.byte(v);
    this.byte(v >> 8);
  }

  bytes(list: ArrayLike<number>): void {
    for (let i = 0; i < list.length; i++) this.byte(list[i]!);
  }

  text(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  result(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

/** 色の数を表すのに要るビット数（1〜8。色表の大きさは 2 のこの乗）。 */
function tableBits(colors: number): number {
  let bits = 1;
  while (1 << bits < colors) bits++;
  return bits;
}

/** GIF の LZW で縮めて、255 バイトずつのブロックにして `out` に書く。 */
function writeLzw(out: ByteBuffer, indices: Uint8Array, minCodeSize: number): void {
  out.byte(minCodeSize);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let block: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const flushBlock = (): void => {
    if (block.length === 0) return;
    out.byte(block.length);
    out.bytes(block);
    block = [];
  };
  const emit = (code: number, size: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      block.push(bitBuffer & 0xff);
      if (block.length === 255) flushBlock();
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = end + 1;
  let codeSize = minCodeSize + 1;
  emit(clear, codeSize);
  if (indices.length > 0) {
    let prefix = indices[0]!;
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i]!;
      const key = (prefix << 8) | k;
      const found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix, codeSize);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        emit(clear, codeSize);
        dict = new Map();
        next = end + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
    emit(prefix, codeSize);
  }
  emit(end, codeSize);
  if (bitCount > 0) {
    block.push(bitBuffer & 0xff);
    if (block.length === 255) flushBlock();
  }
  flushBlock();
  out.byte(0);
}

/** GIF89a を 1 コマずつ書く。 */
export class GifWriter {
  private readonly out = new ByteBuffer();
  private frames = 0;
  private finished = false;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly options: GifOptions = {},
  ) {
    if (width < 1 || height < 1 || width > 0xffff || height > 0xffff) throw new Error(`GIF の大きさが不正です: ${width}×${height}`);
    const o = this.out;
    o.text("GIF89a");
    o.u16(width);
    o.u16(height);
    o.byte(0); // 全体の色表なし（コマごとに持つ）
    o.byte(0); // 背景色
    o.byte(0); // 縦横比
  }

  /** 書いたコマの数。 */
  get frameCount(): number {
    return this.frames;
  }

  /** 1 コマ足す。`rgba` は width×height×4 バイト。`delayMs` はこのコマを出す時間（10ms 単位に丸める）。 */
  addFrame(rgba: ArrayLike<number>, delayMs: number): void {
    if (this.finished) throw new Error("書き終えた GIF にはコマを足せません");
    const pixels = this.width * this.height;
    if (rgba.length < pixels * 4) throw new Error("コマの画素が足りません");
    const o = this.out;
    if (this.frames === 0) {
      // NETSCAPE2.0（繰り返し）
      o.bytes([0x21, 0xff, 0x0b]);
      o.text("NETSCAPE2.0");
      o.bytes([0x03, 0x01]);
      o.u16(this.options.loop ?? 0);
      o.byte(0);
    }
    const image = quantizeRgba(rgba, pixels);
    // 画像制御拡張（待ち時間。前のコマは残さず置き換える）
    o.bytes([0x21, 0xf9, 0x04, 0x04]);
    o.u16(Math.max(0, Math.round(delayMs / 10)));
    o.byte(0);
    o.byte(0);
    // 画像の記述子とコマの色表
    const bits = tableBits(image.colors);
    o.byte(0x2c);
    o.u16(0);
    o.u16(0);
    o.u16(this.width);
    o.u16(this.height);
    o.byte(0x80 | (bits - 1));
    o.bytes(image.palette.subarray(0, (1 << bits) * 3));
    writeLzw(o, image.indices, Math.max(2, bits));
    this.frames++;
  }

  /** 書き終えて GIF のバイト列を返す。 */
  finish(): Uint8Array {
    if (!this.finished) {
      this.out.byte(0x3b);
      this.finished = true;
    }
    return this.out.result();
  }
}
