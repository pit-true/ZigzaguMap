import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { connectionCodec, connectionHeaderCodec } from "./ConnectionCodec.js";
import { CONNECTION_HEADER_SIZE, CONNECTION_SIZE } from "./layout.js";
import type { ConnectionHeader, MapConnection } from "./types.js";

/** 接続の件数の上限（壊れた値をはじくため）。 */
const MAX_CONNECTIONS = 255;

/** ROM から接続ヘッダーと接続の一覧を読むクラス。 */
export class ConnectionReader {
  constructor(private readonly rom: Rom) {}

  /** `offset` の接続ヘッダーを読む。 */
  readHeader(offset: number): ConnectionHeader {
    return connectionHeaderCodec.decode(this.rom.slice(offset, CONNECTION_HEADER_SIZE));
  }

  /** 一覧の元のバイト列。件数 0 なら空。 */
  rawList(header: ConnectionHeader): Uint8Array {
    if (header.count === 0) return new Uint8Array(0);
    if (header.count > MAX_CONNECTIONS) throw new RomError(`接続の件数が不正です: ${header.count}`);
    if (!this.rom.isPointer(header.connections)) {
      throw new RomError(`接続一覧のポインタが ROM 外です: 0x${header.connections.toString(16)}`);
    }
    return this.rom.slice(header.connections - ROM_BASE, header.count * CONNECTION_SIZE);
  }

  /** `offset` の接続ヘッダーと、その先の一覧を読む。 */
  read(offset: number): MapConnection[] {
    const header = this.readHeader(offset);
    return connectionCodec.decodeAll(this.rawList(header));
  }
}
