import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { wildHeaderCodec, wildInfoCodec, wildSlotCodec } from "./WildCodec.js";
import {
  MAX_WILD_HEADERS,
  WILD_AREA_COUNT,
  WILD_HEADER_SIZE,
  WILD_INFO_SIZE,
  WILD_SLOT_COUNTS,
  WILD_SLOT_SIZE,
  WILD_TABLE_END,
  WildTime,
} from "./layout.js";
import type { WildArea, WildEncounters, WildHeader } from "./types.js";

/** 野生ヘッダー表の 1 件と、その位置。 */
export interface WildTableEntry {
  /** ヘッダーの位置（ROM 先頭から）。 */
  readonly offset: number;
  readonly header: WildHeader;
}

/**
 * 野生ヘッダー表（素の ROM では昼の表だけ）。
 * 表の終わりは、バンク・マップ番号がともに 0xFF の件。
 */
export class WildTable {
  /** 表の位置。 */
  readonly offset: number;
  /** 表の各件（終端は含まない）。 */
  readonly entries: readonly WildTableEntry[];

  private constructor(
    private readonly rom: Rom,
    offset: number,
    entries: WildTableEntry[],
  ) {
    this.offset = offset;
    this.entries = entries;
  }

  /** 表へのポインタが置かれている位置から読む。 */
  static read(rom: Rom, tablePointerOffset: number): WildTable {
    const start = rom.pointer(tablePointerOffset);
    const entries: WildTableEntry[] = [];
    for (let n = 0; ; n++) {
      if (n >= MAX_WILD_HEADERS) throw new RomError("野生ヘッダー表が終端しません");
      const at = start + n * WILD_HEADER_SIZE;
      const header = wildHeaderCodec.decode(rom.slice(at, WILD_HEADER_SIZE));
      if (header.bank === WILD_TABLE_END && header.map === WILD_TABLE_END) break;
      entries.push({ offset: at, header });
    }
    return new WildTable(rom, start, entries);
  }

  /** そのマップの最初の件。無ければ null。 */
  find(bank: number, map: number): WildTableEntry | null {
    return this.entries.find((e) => e.header.bank === bank && e.header.map === map) ?? null;
  }

  /**
   * エリア情報のポインタからエリアを読む。ポインタが 0 なら、出現率 0・スロット無し。
   * `kind` は 0〜3（陸・水・岩砕き・釣り）でスロット数が決まる。
   */
  readArea(infoPointer: number, kind: number): WildArea {
    if (infoPointer === 0) return { rate: 0, slots: [] };
    const info = wildInfoCodec.decode(this.rom.slice(this.toOffset(infoPointer), WILD_INFO_SIZE));
    const count = WILD_SLOT_COUNTS[kind] ?? 0;
    const slots = wildSlotCodec.decodeList(this.rom.slice(this.toOffset(info.slots), count * WILD_SLOT_SIZE), count);
    return { rate: info.rate, slots };
  }

  /** そのマップの野生（昼）を読む。表に無ければ空の配列。 */
  readEncounters(bank: number, map: number): WildEncounters[] {
    const entry = this.find(bank, map);
    if (!entry) return [];
    const areas: WildArea[] = [];
    for (let i = 0; i < WILD_AREA_COUNT; i++) areas.push(this.readArea(entry.header.areas[i]!, i));
    return [{ time: WildTime.Day, areas }];
  }

  private toOffset(pointer: number): number {
    if (!this.rom.isPointer(pointer)) throw new RomError(`野生のポインタが ROM 外です: 0x${pointer.toString(16)}`);
    return pointer - ROM_BASE;
  }
}
