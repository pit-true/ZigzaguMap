import { StructCodec } from "../binary/StructCodec.js";
import { readU16, readU32, readU8, writeU16, writeU32, writeU8 } from "../binary/bytes.js";
import { PERSON, PERSON_SIZE } from "./layout.js";
import type { PersonEvent } from "./types.js";

/** 人（24 バイト）の相互変換。 */
export class PersonCodec extends StructCodec<PersonEvent> {
  readonly size = PERSON_SIZE;
  readonly label = "人";

  protected read(b: Uint8Array, o: number): PersonEvent {
    const range = readU8(b, o + PERSON.movementRange);
    return {
      localId: readU8(b, o + PERSON.localId),
      graphicsId: readU8(b, o + PERSON.graphicsId),
      kind: readU8(b, o + PERSON.kind),
      padding1: readU8(b, o + PERSON.padding1),
      x: readU16(b, o + PERSON.x),
      y: readU16(b, o + PERSON.y),
      elevation: readU8(b, o + PERSON.elevation),
      movementType: readU8(b, o + PERSON.movementType),
      movementRangeX: range & 0x0f,
      movementRangeY: range >> 4,
      padding2: readU8(b, o + PERSON.padding2),
      trainerType: readU16(b, o + PERSON.trainerType),
      trainerRangeOrBerryTree: readU16(b, o + PERSON.trainerRangeOrBerryTree),
      script: readU32(b, o + PERSON.script),
      flag: readU16(b, o + PERSON.flag),
      padding3: readU16(b, o + PERSON.padding3),
    };
  }

  protected write(v: PersonEvent, b: Uint8Array, o: number): void {
    writeU8(b, o + PERSON.localId, v.localId);
    writeU8(b, o + PERSON.graphicsId, v.graphicsId);
    writeU8(b, o + PERSON.kind, v.kind);
    writeU8(b, o + PERSON.padding1, v.padding1);
    writeU16(b, o + PERSON.x, v.x);
    writeU16(b, o + PERSON.y, v.y);
    writeU8(b, o + PERSON.elevation, v.elevation);
    writeU8(b, o + PERSON.movementType, v.movementType);
    writeU8(b, o + PERSON.movementRange, (v.movementRangeX & 0x0f) | ((v.movementRangeY & 0x0f) << 4));
    writeU8(b, o + PERSON.padding2, v.padding2);
    writeU16(b, o + PERSON.trainerType, v.trainerType);
    writeU16(b, o + PERSON.trainerRangeOrBerryTree, v.trainerRangeOrBerryTree);
    writeU32(b, o + PERSON.script, v.script);
    writeU16(b, o + PERSON.flag, v.flag);
    writeU16(b, o + PERSON.padding3, v.padding3);
  }
}

/** 人の変換器。 */
export const personCodec = new PersonCodec();
