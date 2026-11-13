import { StructCodec } from "../binary/StructCodec.js";
import { readU16, readU32, readU8, writeU16, writeU32, writeU8 } from "../binary/bytes.js";
import { TRAP, TRAP_SIZE } from "./layout.js";
import type { TrapEvent } from "./types.js";

/** スクリプトタイル（16 バイト）の相互変換。 */
export class TrapCodec extends StructCodec<TrapEvent> {
  readonly size = TRAP_SIZE;
  readonly label = "スクリプトタイル";

  protected read(b: Uint8Array, o: number): TrapEvent {
    return {
      x: readU16(b, o + TRAP.x),
      y: readU16(b, o + TRAP.y),
      elevation: readU8(b, o + TRAP.elevation),
      padding1: readU8(b, o + TRAP.padding1),
      variable: readU16(b, o + TRAP.variable),
      value: readU16(b, o + TRAP.value),
      padding2: readU16(b, o + TRAP.padding2),
      script: readU32(b, o + TRAP.script),
    };
  }

  protected write(v: TrapEvent, b: Uint8Array, o: number): void {
    writeU16(b, o + TRAP.x, v.x);
    writeU16(b, o + TRAP.y, v.y);
    writeU8(b, o + TRAP.elevation, v.elevation);
    writeU8(b, o + TRAP.padding1, v.padding1);
    writeU16(b, o + TRAP.variable, v.variable);
    writeU16(b, o + TRAP.value, v.value);
    writeU16(b, o + TRAP.padding2, v.padding2);
    writeU32(b, o + TRAP.script, v.script);
  }
}

/** スクリプトタイルの変換器。 */
export const trapCodec = new TrapCodec();
