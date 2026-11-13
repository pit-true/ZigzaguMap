import type { StructCodec } from "../binary/StructCodec.js";
import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { eventHeaderCodec } from "./EventHeaderCodec.js";
import { personCodec } from "./PersonCodec.js";
import { signCodec } from "./SignCodec.js";
import { trapCodec } from "./TrapCodec.js";
import { warpCodec } from "./WarpCodec.js";
import { EVENT_HEADER_SIZE } from "./layout.js";
import type { EventHeader, MapEvents } from "./types.js";

/** ROM からイベント（ヘッダーと 4 種の一覧）を読むクラス。件数 0 の一覧はポインタをたどらない。 */
export class EventReader {
  constructor(private readonly rom: Rom) {}

  /** `offset` のイベントヘッダーを読む。 */
  readHeader(offset: number): EventHeader {
    return eventHeaderCodec.decode(this.rom.slice(offset, EVENT_HEADER_SIZE));
  }

  /** `offset` のイベントヘッダーと、その先の一覧を読む。 */
  read(offset: number): MapEvents {
    const header = this.readHeader(offset);
    return {
      persons: this.readList(personCodec, header.persons, header.personCount),
      warps: this.readList(warpCodec, header.warps, header.warpCount),
      traps: this.readList(trapCodec, header.traps, header.trapCount),
      signs: this.readList(signCodec, header.signs, header.signCount),
    };
  }

  /** 一覧の元のバイト列（件数 × 大きさ）を返す。件数 0 なら空。 */
  rawList(pointer: number, count: number, size: number): Uint8Array {
    if (count === 0) return new Uint8Array(0);
    if (!this.rom.isPointer(pointer)) {
      throw new RomError(`イベント一覧のポインタが ROM 外です: 0x${pointer.toString(16)}`);
    }
    return this.rom.slice(pointer - ROM_BASE, count * size);
  }

  private readList<T>(codec: StructCodec<T>, pointer: number, count: number): T[] {
    return codec.decodeList(this.rawList(pointer, count, codec.size), count);
  }
}
