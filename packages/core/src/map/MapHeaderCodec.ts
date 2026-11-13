import { StructCodec } from "../binary/StructCodec.js";
import { readU16, readU32, readU8, writeU16, writeU32, writeU8 } from "../binary/bytes.js";
import { MAP_HEADER_SIZE, MAP_LAYOUT_SIZE } from "./constants.js";

/** マップヘッダー（28 バイト）のフィールド位置。 */
export const MAP_HEADER = {
  layout: 0x00,
  events: 0x04,
  scripts: 0x08,
  connections: 0x0c,
  music: 0x10,
  layoutId: 0x12,
  regionMapSectionId: 0x14,
  cave: 0x15,
  weather: 0x16,
  mapType: 0x17,
  bikingAllowed: 0x18,
  flags: 0x19,
  floorNum: 0x1a,
  battleType: 0x1b,
} as const;

/** ポインタ部分の終わり（ここから後ろがマップの設定）。 */
export const MAP_HEADER_POINTERS_END = 0x10;

/** フッター（レイアウト、28 バイト）のフィールド位置。 */
export const MAP_FOOTER = {
  width: 0x00,
  height: 0x04,
  border: 0x08,
  blocks: 0x0c,
  primaryTileset: 0x10,
  secondaryTileset: 0x14,
  borderWidth: 0x18,
  borderHeight: 0x19,
  padding: 0x1a,
} as const;

/** マップヘッダーのうち、ポインタ以外の設定。 */
export interface MapHeaderFields {
  music: number;
  layoutId: number;
  /** 地名番号（マップ名 ID）。 */
  regionMapSectionId: number;
  cave: number;
  weather: number;
  mapType: number;
  bikingAllowed: number;
  flags: number;
  /** 階数（符号つき）。 */
  floorNum: number;
  battleType: number;
}

/** マップヘッダーの全フィールド。ポインタはそのままの値。 */
export interface RawMapHeader extends MapHeaderFields {
  layout: number;
  events: number;
  scripts: number;
  connections: number;
}

/** フッターの全フィールド。ポインタはそのままの値。 */
export interface RawMapFooter {
  width: number;
  height: number;
  border: number;
  blocks: number;
  primaryTileset: number;
  secondaryTileset: number;
  borderWidth: number;
  borderHeight: number;
  padding: number;
}

/** マップヘッダー（28 バイト）の相互変換。 */
export class MapHeaderCodec extends StructCodec<RawMapHeader> {
  readonly size = MAP_HEADER_SIZE;
  readonly label = "マップヘッダー";

  protected read(b: Uint8Array, o: number): RawMapHeader {
    const floor = readU8(b, o + MAP_HEADER.floorNum);
    return {
      layout: readU32(b, o + MAP_HEADER.layout),
      events: readU32(b, o + MAP_HEADER.events),
      scripts: readU32(b, o + MAP_HEADER.scripts),
      connections: readU32(b, o + MAP_HEADER.connections),
      music: readU16(b, o + MAP_HEADER.music),
      layoutId: readU16(b, o + MAP_HEADER.layoutId),
      regionMapSectionId: readU8(b, o + MAP_HEADER.regionMapSectionId),
      cave: readU8(b, o + MAP_HEADER.cave),
      weather: readU8(b, o + MAP_HEADER.weather),
      mapType: readU8(b, o + MAP_HEADER.mapType),
      bikingAllowed: readU8(b, o + MAP_HEADER.bikingAllowed),
      flags: readU8(b, o + MAP_HEADER.flags),
      floorNum: floor >= 0x80 ? floor - 0x100 : floor,
      battleType: readU8(b, o + MAP_HEADER.battleType),
    };
  }

  protected write(v: RawMapHeader, b: Uint8Array, o: number): void {
    writeU32(b, o + MAP_HEADER.layout, v.layout);
    writeU32(b, o + MAP_HEADER.events, v.events);
    writeU32(b, o + MAP_HEADER.scripts, v.scripts);
    writeU32(b, o + MAP_HEADER.connections, v.connections);
    writeU16(b, o + MAP_HEADER.music, v.music);
    writeU16(b, o + MAP_HEADER.layoutId, v.layoutId);
    writeU8(b, o + MAP_HEADER.regionMapSectionId, v.regionMapSectionId);
    writeU8(b, o + MAP_HEADER.cave, v.cave);
    writeU8(b, o + MAP_HEADER.weather, v.weather);
    writeU8(b, o + MAP_HEADER.mapType, v.mapType);
    writeU8(b, o + MAP_HEADER.bikingAllowed, v.bikingAllowed);
    writeU8(b, o + MAP_HEADER.flags, v.flags);
    writeU8(b, o + MAP_HEADER.floorNum, v.floorNum);
    writeU8(b, o + MAP_HEADER.battleType, v.battleType);
  }
}

/** フッター（28 バイト）の相互変換。 */
export class MapFooterCodec extends StructCodec<RawMapFooter> {
  readonly size = MAP_LAYOUT_SIZE;
  readonly label = "フッター";

  protected read(b: Uint8Array, o: number): RawMapFooter {
    return {
      width: readU32(b, o + MAP_FOOTER.width),
      height: readU32(b, o + MAP_FOOTER.height),
      border: readU32(b, o + MAP_FOOTER.border),
      blocks: readU32(b, o + MAP_FOOTER.blocks),
      primaryTileset: readU32(b, o + MAP_FOOTER.primaryTileset),
      secondaryTileset: readU32(b, o + MAP_FOOTER.secondaryTileset),
      borderWidth: readU8(b, o + MAP_FOOTER.borderWidth),
      borderHeight: readU8(b, o + MAP_FOOTER.borderHeight),
      padding: readU16(b, o + MAP_FOOTER.padding),
    };
  }

  protected write(v: RawMapFooter, b: Uint8Array, o: number): void {
    writeU32(b, o + MAP_FOOTER.width, v.width);
    writeU32(b, o + MAP_FOOTER.height, v.height);
    writeU32(b, o + MAP_FOOTER.border, v.border);
    writeU32(b, o + MAP_FOOTER.blocks, v.blocks);
    writeU32(b, o + MAP_FOOTER.primaryTileset, v.primaryTileset);
    writeU32(b, o + MAP_FOOTER.secondaryTileset, v.secondaryTileset);
    writeU8(b, o + MAP_FOOTER.borderWidth, v.borderWidth);
    writeU8(b, o + MAP_FOOTER.borderHeight, v.borderHeight);
    writeU16(b, o + MAP_FOOTER.padding, v.padding);
  }
}

/** マップヘッダーの変換器。 */
export const mapHeaderCodec = new MapHeaderCodec();
/** フッターの変換器。 */
export const mapFooterCodec = new MapFooterCodec();
