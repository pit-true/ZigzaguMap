import { DataError } from "../binary/DataError.js";
import { BLOCK_DEFINITION_SIZE } from "../map/constants.js";
import { BLOCK_TILE_COUNT } from "./blockFormat.js";

/** .bvd の末尾の印（FR/LG）。 */
const FRLG_TAG = "FRLG";
/** .bvd の末尾の印（ルビー・サファイア・エメラルド）。 */
const RSE_TAG = "RSE ";

/** .bvd から読んだブロック定義と属性。 */
export interface BvdData {
  /** ブロック定義（1 ブロック 8 個の u16）。 */
  readonly blocks: Uint16Array;
  /** 属性（FR の u32。RSE の .bvd は挙動と重なりだけを移す）。 */
  readonly attributes: Uint32Array;
  /** 末尾の印が RSE だったか。 */
  readonly fromRse: boolean;
}

/**
 * AdvanceMap 1.92 のブロックデータ（.bvd、Block Editor, Block und Verhaltens Daten）の読み書き。
 * 形式は Porymap の AdvanceMapParser::parseMetatiles と同じ:
 * ブロック数（u32 LE）、ブロック定義（16 バイト × 数）、属性（FR/LG は 4 バイト、RSE は 2 バイト × 数）、
 * 末尾の 4 バイトの印（"FRLG" か "RSE "）。
 */
export class BvdFile {
  /** FR/LG の .bvd を作る。 */
  static write(blocks: Uint16Array, attributes: Uint32Array): Uint8Array {
    const count = attributes.length;
    const out = new Uint8Array(4 + count * BLOCK_DEFINITION_SIZE + count * 4 + 4);
    const v = new DataView(out.buffer);
    v.setUint32(0, count, true);
    for (let i = 0; i < count * BLOCK_TILE_COUNT; i++) v.setUint16(4 + i * 2, blocks[i] ?? 0, true);
    const attrAt = 4 + count * BLOCK_DEFINITION_SIZE;
    for (let i = 0; i < count; i++) v.setUint32(attrAt + i * 4, attributes[i]! >>> 0, true);
    for (let i = 0; i < 4; i++) out[out.length - 4 + i] = FRLG_TAG.charCodeAt(i);
    return out;
  }

  /**
   * .bvd を読む。`capacity` はタイルセットのブロック数の上限（主 640、副 384）。
   * 形が違う・数が 0 か上限を超えるときは DataError（文は Porymap と同じ内容の日本語）。
   */
  static read(bytes: Uint8Array, capacity: number): BvdData {
    if (bytes.length < 9 || bytes.length % 2 !== 0) throw new DataError(".bvd ファイルの大きさが不正です");
    const tag = String.fromCharCode(...bytes.subarray(bytes.length - 4));
    if (tag !== FRLG_TAG && tag !== RSE_TAG) throw new DataError(".bvd ファイルの末尾 4 バイトが 'FRLG' でも 'RSE ' でもありません");
    const fromRse = tag === RSE_TAG;
    const attrSize = fromRse ? 2 : 4;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = v.getUint32(0, true);
    if (count < 1) throw new DataError(".bvd ファイルにブロックがありません");
    if (count > capacity) throw new DataError(`.bvd ファイルのブロック数 ${count} が上限 ${capacity} を超えています`);
    const expected = 4 + count * BLOCK_DEFINITION_SIZE + count * attrSize + 4;
    if (bytes.length !== expected) throw new DataError(`.bvd ファイルの大きさが違います（${expected} バイトのはずが ${bytes.length} バイト）`);
    const blocks = new Uint16Array(count * BLOCK_TILE_COUNT);
    for (let i = 0; i < blocks.length; i++) blocks[i] = v.getUint16(4 + i * 2, true);
    const attrAt = 4 + count * BLOCK_DEFINITION_SIZE;
    const attributes = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      if (fromRse) {
        const a = v.getUint16(attrAt + i * 2, true);
        // RSE: 挙動 8 ビット、重なり 4 ビット（ビット 12〜15）。FR の挙動（ビット 0〜8）と重なり（ビット 29〜30）へ移す。
        attributes[i] = ((a & 0xff) | (((a >> 12) & 0x3) << 29)) >>> 0;
      } else {
        attributes[i] = v.getUint32(attrAt + i * 4, true);
      }
    }
    return { blocks, attributes, fromRse };
  }
}
