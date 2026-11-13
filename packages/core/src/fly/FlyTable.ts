import { StructCodec } from "../binary/StructCodec.js";
import { readU16, readU8, writeU16, writeU8 } from "../binary/bytes.js";
import type { GameOffsets } from "../game/offsets.js";
import type { MapId } from "../map/types.js";
import type { Rom } from "../rom/Rom.js";
import type { FlyPosition } from "./types.js";

/** フライトポジション 1 件のバイト数。 */
export const FLY_POSITION_SIZE = 8;

/** フライトポジションのフィールド位置。 */
export const FLY_POSITION = { bank: 0, map: 1, x: 2, y: 4, unknown: 6 } as const;

/** フライトポジション（8 バイト）の相互変換。 */
export class FlyPositionCodec extends StructCodec<FlyPosition> {
  readonly size = FLY_POSITION_SIZE;
  readonly label = "フライトポジション";

  protected read(b: Uint8Array, o: number): FlyPosition {
    return {
      bank: readU8(b, o + FLY_POSITION.bank),
      map: readU8(b, o + FLY_POSITION.map),
      x: readU16(b, o + FLY_POSITION.x),
      y: readU16(b, o + FLY_POSITION.y),
      unknown: readU16(b, o + FLY_POSITION.unknown),
    };
  }

  protected write(v: FlyPosition, b: Uint8Array, o: number): void {
    writeU8(b, o + FLY_POSITION.bank, v.bank);
    writeU8(b, o + FLY_POSITION.map, v.map);
    writeU16(b, o + FLY_POSITION.x, v.x);
    writeU16(b, o + FLY_POSITION.y, v.y);
    writeU16(b, o + FLY_POSITION.unknown, v.unknown);
  }
}

/** フライトポジションの変換器。 */
export const flyPositionCodec = new FlyPositionCodec();

/**
 * ROM のフライトポジションの表（AdvanceMap の FlugposHeader が指す表）。
 * マップのフライトポジションは、バンク・マップが一致する最初の 1 件（AdvanceMap と同じ）。
 */
export class FlyTable {
  private constructor(
    /** 表の位置（ROM 先頭から）。 */
    readonly offset: number,
    /** ROM に書かれている値。 */
    readonly entries: readonly FlyPosition[],
  ) {}

  /** ROM から読む。 */
  static read(rom: Rom, offsets: GameOffsets): FlyTable {
    const offset = rom.pointer(offsets.flyTablePointer);
    const entries = flyPositionCodec.decodeList(rom.slice(offset, offsets.flyTableCount * FLY_POSITION_SIZE), offsets.flyTableCount);
    return new FlyTable(offset, entries);
  }

  /** `index` 番の位置（ROM 先頭から）。 */
  entryOffset(index: number): number {
    return this.offset + index * FLY_POSITION_SIZE;
  }
}

/** そのマップのフライトポジションの番号。無ければ -1。 */
export function findFlyPosition(positions: readonly FlyPosition[], id: MapId): number {
  return positions.findIndex((p) => p.bank === id.bank && p.map === id.map);
}

/** フライトポジションの写し。 */
export function cloneFlyPositions(positions: readonly FlyPosition[]): FlyPosition[] {
  return positions.map((p) => ({ ...p }));
}
