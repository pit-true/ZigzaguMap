import type { Rom } from "../rom/Rom.js";
import { MAP_HEADER_SIZE } from "./constants.js";
import type { MapHeader } from "./types.js";

/** マップヘッダー（28 バイト）を読むクラス。 */
export class MapHeaderReader {
  constructor(private readonly rom: Rom) {}

  /** `offset` のマップヘッダーを読む。 */
  read(offset: number): MapHeader {
    const rom = this.rom;
    rom.check(offset, MAP_HEADER_SIZE);
    return {
      offset,
      layoutOffset: rom.pointer(offset + 0x00),
      eventsOffset: rom.pointerOrNull(offset + 0x04),
      scriptsOffset: rom.pointerOrNull(offset + 0x08),
      connectionsOffset: rom.pointerOrNull(offset + 0x0c),
      music: rom.u16(offset + 0x10),
      layoutId: rom.u16(offset + 0x12),
      regionMapSectionId: rom.u8(offset + 0x14),
      cave: rom.u8(offset + 0x15),
      weather: rom.u8(offset + 0x16),
      mapType: rom.u8(offset + 0x17),
      bikingAllowed: rom.u8(offset + 0x18),
      flags: rom.u8(offset + 0x19),
      floorNum: rom.s8(offset + 0x1a),
      battleType: rom.u8(offset + 0x1b),
    };
  }
}
