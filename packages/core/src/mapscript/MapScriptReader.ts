import { readU16 } from "../binary/bytes.js";
import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { mapScriptCodec } from "./MapScriptCodec.js";
import {
  MAP_SCRIPT_ENTRY_SIZE,
  MAP_SCRIPT_TABLE_ENTRY_SIZE,
  MAP_SCRIPT_TERMINATOR_SIZE,
  MAX_MAP_SCRIPT_ENTRIES,
  MapScriptType,
  isTableType,
} from "./layout.js";
import type { MapScriptEntry } from "./types.js";

/** ROM 上のマップスクリプトの元のバイト列。 */
export interface RawMapScripts {
  /** 一覧（終端の 0 を含む）。 */
  readonly list: Uint8Array;
  /** 一覧の何件目か → 条件表（終端の 8 バイトを含む）。 */
  readonly tables: ReadonlyMap<number, Uint8Array>;
}

/** ROM からマップスクリプトの一覧と条件表を読むクラス。 */
export class MapScriptReader {
  constructor(private readonly rom: Rom) {}

  /** `offset` の一覧と、種類 2・4 が指す条件表の元のバイト列を読む。 */
  readRaw(offset: number): RawMapScripts {
    const rom = this.rom;
    let length = 0;
    for (let n = 0; ; n++) {
      if (n > MAX_MAP_SCRIPT_ENTRIES) throw new RomError(`マップスクリプトの一覧が終端しません (0x${offset.toString(16)})`);
      if (rom.u8(offset + length) === MapScriptType.End) break;
      length += MAP_SCRIPT_ENTRY_SIZE;
    }
    const list = rom.slice(offset, length + MAP_SCRIPT_TERMINATOR_SIZE);
    const tables = new Map<number, Uint8Array>();
    mapScriptCodec.decodeList(list).forEach((head, index) => {
      if (!isTableType(head.type) || head.pointer === 0) return;
      if (!rom.isPointer(head.pointer)) {
        throw new RomError(`マップスクリプトの条件表のポインタが ROM 外です: 0x${head.pointer.toString(16)}`);
      }
      tables.set(index, this.readTableBytes(head.pointer - ROM_BASE));
    });
    return { list, tables };
  }

  /** `offset` のマップスクリプトを読む。 */
  read(offset: number): MapScriptEntry[] {
    const raw = this.readRaw(offset);
    return mapScriptCodec.decodeList(raw.list).map((head, index) => {
      const table = raw.tables.get(index);
      return { type: head.type, pointer: head.pointer, table: table ? mapScriptCodec.decodeTable(table) : null };
    });
  }

  /** 条件表を、変数 0 の件（8 バイト）まで読む。 */
  private readTableBytes(offset: number): Uint8Array {
    for (let n = 0; n < MAX_MAP_SCRIPT_ENTRIES; n++) {
      const at = offset + n * MAP_SCRIPT_TABLE_ENTRY_SIZE;
      this.rom.check(at, MAP_SCRIPT_TABLE_ENTRY_SIZE);
      if (readU16(this.rom.bytes, at) === 0) return this.rom.slice(offset, (n + 1) * MAP_SCRIPT_TABLE_ENTRY_SIZE);
    }
    throw new RomError(`マップスクリプトの条件表が終端しません (0x${offset.toString(16)})`);
  }
}
