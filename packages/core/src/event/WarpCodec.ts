import { StructCodec } from "../binary/StructCodec.js";
import { readU16, readU8, writeU16, writeU8 } from "../binary/bytes.js";
import { WARP, WARP_SIZE } from "./layout.js";
import type { WarpEvent } from "./types.js";

/** ワープ（8 バイト）の相互変換。 */
export class WarpCodec extends StructCodec<WarpEvent> {
  readonly size = WARP_SIZE;
  readonly label = "ワープ";

  protected read(b: Uint8Array, o: number): WarpEvent {
    return {
      x: readU16(b, o + WARP.x),
      y: readU16(b, o + WARP.y),
      elevation: readU8(b, o + WARP.elevation),
      warpId: readU8(b, o + WARP.warpId),
      map: readU8(b, o + WARP.map),
      bank: readU8(b, o + WARP.bank),
    };
  }

  protected write(v: WarpEvent, b: Uint8Array, o: number): void {
    writeU16(b, o + WARP.x, v.x);
    writeU16(b, o + WARP.y, v.y);
    writeU8(b, o + WARP.elevation, v.elevation);
    writeU8(b, o + WARP.warpId, v.warpId);
    writeU8(b, o + WARP.map, v.map);
    writeU8(b, o + WARP.bank, v.bank);
  }
}

/** ワープの変換器。 */
export const warpCodec = new WarpCodec();
