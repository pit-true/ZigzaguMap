import { DataError } from "./DataError.js";
import { requireBytes } from "./bytes.js";

/**
 * 固定長の構造体と型つきオブジェクトの相互変換。
 * 派生クラスは `size`・`read`・`write` を実装する。`decode` → `encode` で元のバイト列に戻ること。
 */
export abstract class StructCodec<T> {
  /** 構造体 1 個のバイト数。 */
  abstract readonly size: number;
  /** 構造体の名前（エラー表示用）。 */
  abstract readonly label: string;

  /** `bytes` の `offset` から 1 個読む（範囲は確認済み）。 */
  protected abstract read(bytes: Uint8Array, offset: number): T;
  /** `out` の `offset` へ 1 個書く（`out` は 0 で埋まっている）。 */
  protected abstract write(value: T, out: Uint8Array, offset: number): void;

  /** バイト列から 1 個読む。足りなければ DataError。 */
  decode(bytes: Uint8Array, offset = 0): T {
    requireBytes(bytes, offset, this.size, this.label);
    return this.read(bytes, offset);
  }

  /** 1 個をバイト列にする。 */
  encode(value: T): Uint8Array {
    const out = new Uint8Array(this.size);
    this.write(value, out, 0);
    return out;
  }

  /** 連続した `count` 個を読む。 */
  decodeList(bytes: Uint8Array, count: number, offset = 0): T[] {
    requireBytes(bytes, offset, count * this.size, this.label);
    const list: T[] = [];
    for (let i = 0; i < count; i++) list.push(this.read(bytes, offset + i * this.size));
    return list;
  }

  /** バイト列の全体を、この構造体の並びとして読む。長さが割り切れなければ DataError。 */
  decodeAll(bytes: Uint8Array): T[] {
    if (bytes.length % this.size !== 0) {
      throw new DataError(`${this.label}: 長さ ${bytes.length} が ${this.size} の倍数ではありません`);
    }
    return this.decodeList(bytes, bytes.length / this.size);
  }

  /** 並びをバイト列にする。 */
  encodeList(values: readonly T[]): Uint8Array {
    const out = new Uint8Array(values.length * this.size);
    values.forEach((v, i) => this.write(v, out, i * this.size));
    return out;
  }
}
