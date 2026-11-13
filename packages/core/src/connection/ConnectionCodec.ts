import { StructCodec } from "../binary/StructCodec.js";
import { readS32, readU16, readU32, readU8, writeU16, writeU32, writeU8 } from "../binary/bytes.js";
import { CONNECTION, CONNECTION_HEADER, CONNECTION_HEADER_SIZE, CONNECTION_SIZE } from "./layout.js";
import type { ConnectionHeader, MapConnection } from "./types.js";

/** 接続ヘッダー（8 バイト）の相互変換。 */
export class ConnectionHeaderCodec extends StructCodec<ConnectionHeader> {
  readonly size = CONNECTION_HEADER_SIZE;
  readonly label = "接続ヘッダー";

  protected read(b: Uint8Array, o: number): ConnectionHeader {
    return {
      count: readU32(b, o + CONNECTION_HEADER.count),
      connections: readU32(b, o + CONNECTION_HEADER.connections),
    };
  }

  protected write(v: ConnectionHeader, b: Uint8Array, o: number): void {
    writeU32(b, o + CONNECTION_HEADER.count, v.count);
    writeU32(b, o + CONNECTION_HEADER.connections, v.connections);
  }
}

/** 接続 1 件（12 バイト）の相互変換。 */
export class ConnectionCodec extends StructCodec<MapConnection> {
  readonly size = CONNECTION_SIZE;
  readonly label = "接続";

  protected read(b: Uint8Array, o: number): MapConnection {
    return {
      direction: readU32(b, o + CONNECTION.direction),
      offset: readS32(b, o + CONNECTION.offset),
      bank: readU8(b, o + CONNECTION.bank),
      map: readU8(b, o + CONNECTION.map),
      padding: readU16(b, o + CONNECTION.padding),
    };
  }

  protected write(v: MapConnection, b: Uint8Array, o: number): void {
    writeU32(b, o + CONNECTION.direction, v.direction);
    writeU32(b, o + CONNECTION.offset, v.offset);
    writeU8(b, o + CONNECTION.bank, v.bank);
    writeU8(b, o + CONNECTION.map, v.map);
    writeU16(b, o + CONNECTION.padding, v.padding);
  }
}

/** 接続ヘッダーの変換器。 */
export const connectionHeaderCodec = new ConnectionHeaderCodec();
/** 接続の変換器。 */
export const connectionCodec = new ConnectionCodec();
