import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { MAP_HEADER_SIZE } from "./constants.js";
import type { MapId } from "./types.js";

/** バンクの数の上限（u8）。 */
const MAX_BANKS = 255;
/** 1 バンクのマップ数の上限。 */
const MAX_MAPS_PER_BANK = 255;

/**
 * マップバンク表。バンクごとに、マップヘッダーの位置の一覧を持つ。
 * マップ数は ROM に書かれていないため、各バンクの一覧の終わりを
 * 「次に始まる一覧またはバンク表自身」と「マップヘッダーを指さない値」で推定する。
 */
export class MapBankTable {
  /** バンク表の位置。 */
  readonly offset: number;
  /** banks[バンク][マップ] = マップヘッダーの位置。 */
  readonly banks: readonly (readonly number[])[];

  private constructor(offset: number, banks: number[][]) {
    this.offset = offset;
    this.banks = banks;
  }

  /** バンク表へのポインタ位置から表を読む。 */
  static read(rom: Rom, tablePointerOffset: number): MapBankTable {
    const root = rom.pointer(tablePointerOffset);
    const lists: number[] = [];
    while (lists.length < MAX_BANKS && rom.inRange(root + lists.length * 4, 4)) {
      const value = rom.u32(root + lists.length * 4);
      if (!rom.isPointer(value)) break;
      lists.push(value - ROM_BASE);
    }
    if (lists.length === 0) throw new RomError("マップバンク表が空です");

    const boundaries = [...new Set([...lists, root])].sort((a, b) => a - b);
    const banks = lists.map((start) => {
      const next = boundaries.find((b) => b > start);
      const limit = next === undefined ? MAX_MAPS_PER_BANK : Math.min(MAX_MAPS_PER_BANK, Math.floor((next - start) / 4));
      const headers: number[] = [];
      for (let i = 0; i < limit && rom.inRange(start + i * 4, 4); i++) {
        const value = rom.u32(start + i * 4);
        if (!rom.isPointer(value) || !looksLikeHeader(rom, value - ROM_BASE)) break;
        headers.push(value - ROM_BASE);
      }
      return headers;
    });
    return new MapBankTable(root, banks);
  }

  /**
   * バンクごとのマップ数を指定して表を読む（maps\project.json の BaseBankCounts 用）。
   * 推定はしない。ポインタが ROM 外なら RomError。
   */
  static readWithCounts(rom: Rom, tablePointerOffset: number, counts: readonly number[]): MapBankTable {
    const root = rom.pointer(tablePointerOffset);
    const banks = counts.map((count, bank) => {
      if (count === 0) return [];
      const list = rom.pointer(root + bank * 4);
      const headers: number[] = [];
      for (let i = 0; i < count; i++) headers.push(rom.pointer(list + i * 4));
      return headers;
    });
    return new MapBankTable(root, banks);
  }

  /** 各バンクのマップ数。 */
  counts(): number[] {
    return this.banks.map((b) => b.length);
  }

  /** バンクの数。 */
  get bankCount(): number {
    return this.banks.length;
  }

  /** バンク内のマップ数。範囲外のバンクなら 0。 */
  mapCount(bank: number): number {
    return this.banks[bank]?.length ?? 0;
  }

  /** マップヘッダーの位置。無ければ RomError。 */
  headerOffset(id: MapId): number {
    const offset = this.banks[id.bank]?.[id.map];
    if (offset === undefined) throw new RomError(`マップ ${id.bank}.${id.map} はありません`);
    return offset;
  }

  /** 全マップの番号を順に返す。 */
  *ids(): IterableIterator<MapId> {
    for (let bank = 0; bank < this.banks.length; bank++) {
      for (let map = 0; map < this.banks[bank]!.length; map++) yield { bank, map };
    }
  }
}

/** マップヘッダーらしいか（先頭のフッターへのポインタが ROM 内を指すか）。 */
function looksLikeHeader(rom: Rom, offset: number): boolean {
  return rom.inRange(offset, MAP_HEADER_SIZE) && rom.isPointer(rom.u32(offset));
}
