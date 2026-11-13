import type { Rom } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { MAP_LAYOUT_SIZE } from "./constants.js";
import type { MapLayout } from "./types.js";

/** 幅・高さの上限（明らかに壊れた値をはじくため）。 */
const MAX_DIMENSION = 0x400;

/** フッター（レイアウト、28 バイト）とブロック配置・ボーダーを読むクラス。 */
export class MapLayoutReader {
  constructor(private readonly rom: Rom) {}

  /** `offset` のフッターを読み、配置とボーダーも読み込む。 */
  read(offset: number): MapLayout {
    const rom = this.rom;
    rom.check(offset, MAP_LAYOUT_SIZE);
    const width = rom.u32(offset + 0x00);
    const height = rom.u32(offset + 0x04);
    if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new RomError(`マップの大きさが不正です: ${width}×${height} (0x${offset.toString(16)})`);
    }
    const borderOffset = rom.pointer(offset + 0x08);
    const blocksOffset = rom.pointer(offset + 0x0c);
    const primaryTilesetOffset = rom.pointer(offset + 0x10);
    const secondaryTilesetOffset = rom.pointer(offset + 0x14);
    const borderWidth = rom.u8(offset + 0x18);
    const borderHeight = rom.u8(offset + 0x19);
    return {
      offset,
      width,
      height,
      borderOffset,
      blocksOffset,
      primaryTilesetOffset,
      secondaryTilesetOffset,
      borderWidth,
      borderHeight,
      blocks: rom.u16Array(blocksOffset, width * height),
      border: rom.u16Array(borderOffset, borderWidth * borderHeight),
    };
  }
}
