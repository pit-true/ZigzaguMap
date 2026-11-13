import { DataError } from "../binary/DataError.js";
import { StructCodec } from "../binary/StructCodec.js";
import { concatBytes, readU16, readU32, readU8, writeU16, writeU32, writeU8 } from "../binary/bytes.js";
import {
  MAP_SCRIPT_ENTRY,
  MAP_SCRIPT_ENTRY_SIZE,
  MAP_SCRIPT_TABLE_ENTRY,
  MAP_SCRIPT_TABLE_ENTRY_SIZE,
  MAP_SCRIPT_TERMINATOR_SIZE,
  MapScriptType,
} from "./layout.js";
import type { MapScriptEntry, MapScriptTable, MapScriptTableEntry } from "./types.js";

/** 一覧の 1 件（種類とポインタだけ）。 */
export interface MapScriptHead {
  type: number;
  pointer: number;
}

/** 一覧の 1 件（5 バイト）の相互変換。 */
export class MapScriptHeadCodec extends StructCodec<MapScriptHead> {
  readonly size = MAP_SCRIPT_ENTRY_SIZE;
  readonly label = "マップスクリプト";

  protected read(b: Uint8Array, o: number): MapScriptHead {
    return { type: readU8(b, o + MAP_SCRIPT_ENTRY.type), pointer: readU32(b, o + MAP_SCRIPT_ENTRY.pointer) };
  }

  protected write(v: MapScriptHead, b: Uint8Array, o: number): void {
    writeU8(b, o + MAP_SCRIPT_ENTRY.type, v.type);
    writeU32(b, o + MAP_SCRIPT_ENTRY.pointer, v.pointer);
  }
}

/** 条件表の 1 件（8 バイト）の相互変換。 */
export class MapScriptTableEntryCodec extends StructCodec<MapScriptTableEntry> {
  readonly size = MAP_SCRIPT_TABLE_ENTRY_SIZE;
  readonly label = "マップスクリプトの条件";

  protected read(b: Uint8Array, o: number): MapScriptTableEntry {
    return {
      variable: readU16(b, o + MAP_SCRIPT_TABLE_ENTRY.variable),
      value: readU16(b, o + MAP_SCRIPT_TABLE_ENTRY.value),
      script: readU32(b, o + MAP_SCRIPT_TABLE_ENTRY.script),
    };
  }

  protected write(v: MapScriptTableEntry, b: Uint8Array, o: number): void {
    writeU16(b, o + MAP_SCRIPT_TABLE_ENTRY.variable, v.variable);
    writeU16(b, o + MAP_SCRIPT_TABLE_ENTRY.value, v.value);
    writeU32(b, o + MAP_SCRIPT_TABLE_ENTRY.script, v.script);
  }
}

/** 一覧の 1 件の変換器。 */
export const mapScriptHeadCodec = new MapScriptHeadCodec();
/** 条件表の 1 件の変換器。 */
export const mapScriptTableEntryCodec = new MapScriptTableEntryCodec();

/** 終端の件（8 バイト、すべて 0）。 */
export function emptyTableTail(): Uint8Array {
  return new Uint8Array(MAP_SCRIPT_TABLE_ENTRY_SIZE);
}

/**
 * マップスクリプトの一覧（「種類 1 バイト + ポインタ 4 バイト」の並び、0 終端）と
 * 条件表（8 バイトの並び、変数 0 の件で終端）の相互変換。
 */
export class MapScriptCodec {
  /** 一覧のバイト列（終端の 0 を含む）を読む。終端が無ければ DataError。 */
  decodeList(bytes: Uint8Array): MapScriptHead[] {
    const heads: MapScriptHead[] = [];
    let at = 0;
    for (;;) {
      if (at >= bytes.length) throw new DataError("マップスクリプトの一覧が終端しません");
      if (bytes[at] === MapScriptType.End) break;
      heads.push(mapScriptHeadCodec.decode(bytes, at));
      at += MAP_SCRIPT_ENTRY_SIZE;
    }
    if (at + MAP_SCRIPT_TERMINATOR_SIZE !== bytes.length) {
      throw new DataError("マップスクリプトの一覧の終端の後ろにデータがあります");
    }
    return heads;
  }

  /** 一覧をバイト列にする（終端の 0 を付ける）。 */
  encodeList(heads: readonly MapScriptHead[]): Uint8Array {
    return concatBytes([mapScriptHeadCodec.encodeList(heads), new Uint8Array(MAP_SCRIPT_TERMINATOR_SIZE)]);
  }

  /** 条件表のバイト列を読む。変数 0 の件から後ろは `tail` に入る。 */
  decodeTable(bytes: Uint8Array): MapScriptTable {
    const entries: MapScriptTableEntry[] = [];
    let at = 0;
    while (at + 2 <= bytes.length && readU16(bytes, at) !== 0) {
      entries.push(mapScriptTableEntryCodec.decode(bytes, at));
      at += MAP_SCRIPT_TABLE_ENTRY_SIZE;
    }
    return { entries, tail: bytes.slice(at) };
  }

  /** 条件表をバイト列にする。 */
  encodeTable(table: MapScriptTable): Uint8Array {
    return concatBytes([mapScriptTableEntryCodec.encodeList(table.entries), table.tail]);
  }

  /** 一覧の件（条件表つき）から、一覧のバイト列だけを作る。 */
  encodeEntries(entries: readonly MapScriptEntry[]): Uint8Array {
    return this.encodeList(entries.map((e) => ({ type: e.type, pointer: e.pointer })));
  }
}

/** マップスクリプトの変換器。 */
export const mapScriptCodec = new MapScriptCodec();
