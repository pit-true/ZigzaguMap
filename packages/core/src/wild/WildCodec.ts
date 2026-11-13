import { StructCodec } from "../binary/StructCodec.js";
import { readU16, readU32, readU8, writeU16, writeU32, writeU8 } from "../binary/bytes.js";
import { WILD_HEADER, WILD_HEADER_SIZE, WILD_INFO, WILD_INFO_SIZE, WILD_SLOT, WILD_SLOT_SIZE } from "./layout.js";
import type { WildHeader, WildInfo, WildSlot } from "./types.js";

/** 野生ヘッダー（20 バイト）の相互変換。 */
export class WildHeaderCodec extends StructCodec<WildHeader> {
  readonly size = WILD_HEADER_SIZE;
  readonly label = "野生ヘッダー";

  protected read(b: Uint8Array, o: number): WildHeader {
    const area = (i: number) => readU32(b, o + WILD_HEADER.areas + i * 4);
    return {
      bank: readU8(b, o + WILD_HEADER.bank),
      map: readU8(b, o + WILD_HEADER.map),
      padding: readU16(b, o + WILD_HEADER.padding),
      areas: [area(0), area(1), area(2), area(3)],
    };
  }

  protected write(v: WildHeader, b: Uint8Array, o: number): void {
    writeU8(b, o + WILD_HEADER.bank, v.bank);
    writeU8(b, o + WILD_HEADER.map, v.map);
    writeU16(b, o + WILD_HEADER.padding, v.padding);
    v.areas.forEach((p, i) => writeU32(b, o + WILD_HEADER.areas + i * 4, p));
  }
}

/** エリア情報（8 バイト）の相互変換。 */
export class WildInfoCodec extends StructCodec<WildInfo> {
  readonly size = WILD_INFO_SIZE;
  readonly label = "野生のエリア情報";

  protected read(b: Uint8Array, o: number): WildInfo {
    return {
      rate: readU8(b, o + WILD_INFO.rate),
      padding1: readU8(b, o + WILD_INFO.padding1),
      padding2: readU16(b, o + WILD_INFO.padding2),
      slots: readU32(b, o + WILD_INFO.slots),
    };
  }

  protected write(v: WildInfo, b: Uint8Array, o: number): void {
    writeU8(b, o + WILD_INFO.rate, v.rate);
    writeU8(b, o + WILD_INFO.padding1, v.padding1);
    writeU16(b, o + WILD_INFO.padding2, v.padding2);
    writeU32(b, o + WILD_INFO.slots, v.slots);
  }
}

/** スロット（4 バイト）の相互変換。 */
export class WildSlotCodec extends StructCodec<WildSlot> {
  readonly size = WILD_SLOT_SIZE;
  readonly label = "野生のスロット";

  protected read(b: Uint8Array, o: number): WildSlot {
    return {
      minLevel: readU8(b, o + WILD_SLOT.minLevel),
      maxLevel: readU8(b, o + WILD_SLOT.maxLevel),
      species: readU16(b, o + WILD_SLOT.species),
    };
  }

  protected write(v: WildSlot, b: Uint8Array, o: number): void {
    writeU8(b, o + WILD_SLOT.minLevel, v.minLevel);
    writeU8(b, o + WILD_SLOT.maxLevel, v.maxLevel);
    writeU16(b, o + WILD_SLOT.species, v.species);
  }
}

/** 野生ヘッダーの変換器。 */
export const wildHeaderCodec = new WildHeaderCodec();
/** エリア情報の変換器。 */
export const wildInfoCodec = new WildInfoCodec();
/** スロットの変換器。 */
export const wildSlotCodec = new WildSlotCodec();
