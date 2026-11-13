import { describe, expect, it } from "vitest";
import { ConnectionDirection, ConnectionReader, Rom, connectionCodec, connectionHeaderCodec } from "../src/index.js";
import { CONNECTION_BYTES, SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

function pattern(length: number, seed = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 53 + seed * 11) & 0xff);
}

describe("接続", () => {
  it("decode → encode で元に戻り、ずれは符号つき", () => {
    const c = connectionCodec.decode(Uint8Array.from(CONNECTION_BYTES));
    expect(c).toEqual({ direction: ConnectionDirection.Up, offset: -2, bank: 1, map: 0, padding: 0 });
    expect(connectionCodec.encode(c)).toEqual(Uint8Array.from(CONNECTION_BYTES));
    for (let seed = 0; seed < 8; seed++) {
      const h = pattern(8, seed);
      expect(connectionHeaderCodec.encode(connectionHeaderCodec.decode(h))).toEqual(h);
      const b = pattern(24, seed);
      expect(connectionCodec.encodeList(connectionCodec.decodeAll(b))).toEqual(b);
    }
  });

  it("ROM から読む", () => {
    const list = new ConnectionReader(new Rom(buildSyntheticRom())).read(SYN.connections);
    expect(list).toHaveLength(1);
    expect(list[0]!.offset).toBe(-2);
  });
});
