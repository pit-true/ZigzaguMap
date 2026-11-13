import { StructCodec } from "../binary/StructCodec.js";
import { readU32, readU8, writeU32, writeU8 } from "../binary/bytes.js";
import { EVENT_HEADER, EVENT_HEADER_SIZE } from "./layout.js";
import type { EventHeader } from "./types.js";

/** イベントヘッダー（20 バイト）の相互変換。 */
export class EventHeaderCodec extends StructCodec<EventHeader> {
  readonly size = EVENT_HEADER_SIZE;
  readonly label = "イベントヘッダー";

  protected read(b: Uint8Array, o: number): EventHeader {
    return {
      personCount: readU8(b, o + EVENT_HEADER.personCount),
      warpCount: readU8(b, o + EVENT_HEADER.warpCount),
      trapCount: readU8(b, o + EVENT_HEADER.trapCount),
      signCount: readU8(b, o + EVENT_HEADER.signCount),
      persons: readU32(b, o + EVENT_HEADER.persons),
      warps: readU32(b, o + EVENT_HEADER.warps),
      traps: readU32(b, o + EVENT_HEADER.traps),
      signs: readU32(b, o + EVENT_HEADER.signs),
    };
  }

  protected write(v: EventHeader, b: Uint8Array, o: number): void {
    writeU8(b, o + EVENT_HEADER.personCount, v.personCount);
    writeU8(b, o + EVENT_HEADER.warpCount, v.warpCount);
    writeU8(b, o + EVENT_HEADER.trapCount, v.trapCount);
    writeU8(b, o + EVENT_HEADER.signCount, v.signCount);
    writeU32(b, o + EVENT_HEADER.persons, v.persons);
    writeU32(b, o + EVENT_HEADER.warps, v.warps);
    writeU32(b, o + EVENT_HEADER.traps, v.traps);
    writeU32(b, o + EVENT_HEADER.signs, v.signs);
  }
}

/** イベントヘッダーの変換器。 */
export const eventHeaderCodec = new EventHeaderCodec();
