import { describe, expect, it } from "vitest";
import { mapFooterCodec, mapHeaderCodec } from "../src/index.js";

function pattern(length: number, seed = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 53 + seed * 11) & 0xff);
}

describe("マップヘッダーとフッター", () => {
  it("decode → encode で元に戻る", () => {
    for (let seed = 0; seed < 8; seed++) {
      const b = pattern(28, seed);
      expect(mapHeaderCodec.encode(mapHeaderCodec.decode(b))).toEqual(b);
      expect(mapFooterCodec.encode(mapFooterCodec.decode(b))).toEqual(b);
    }
  });
});
