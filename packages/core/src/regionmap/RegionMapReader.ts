import { ROM_BASE, type Rom } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { REGION_MAP_ADDRESSES, type RegionMapAddresses } from "./addresses.js";
import {
  FLY_DESTINATION_COUNT,
  HEAL_LOCATION_COUNT,
  HEAL_LOCATION_SIZE,
  MAPSEC_COUNT,
  MAPSEC_FIRST,
  MAPSEC_NAMED_COUNT,
  NO_FLAG,
  REGION_MAP_CELLS,
  REGION_MAP_LAYERS,
  REGION_MAP_PAGES,
} from "./constants.js";
import { FlagSwitchReader } from "./FlagSwitchReader.js";
import { RegionMapDocument, type RegionMapSnapshot } from "./RegionMapDocument.js";
import { RegionMapGraphics, type RegionMapGraphicsSource } from "./RegionMapGraphics.js";

/** 表を読んだ位置（ROM 先頭から）。画面の「名前のオフセット」と、ビルド側の取り込みの手がかりに使う。 */
export interface RegionMapTableAddresses {
  /** 面 × レイヤーの地名の表（4 面。各面は 2 レイヤーが続く）。 */
  readonly layouts: readonly number[];
  readonly positions: number;
  readonly sizes: number;
  readonly names: number;
  readonly flyDestinations: number;
  /** 飛び先 1 番の位置。 */
  readonly healLocations: number;
  /** 地名 0x58〜0xC4 の名前の文字列の位置。 */
  readonly nameStrings: readonly number[];
  readonly graphics: RegionMapGraphicsSource;
}

/** ROM から読んだタウンマップ。 */
export interface RegionMapRomData {
  readonly document: RegionMapDocument;
  readonly graphics: RegionMapGraphics;
  readonly addresses: RegionMapTableAddresses;
}

/** ROM のタウンマップを読む。 */
export class RegionMapReader {
  /** 対応しているゲームか。 */
  static supports(gameCode: string): boolean {
    return gameCode in REGION_MAP_ADDRESSES;
  }

  /** ゲームコードの位置で読む。対応していなければ RomError。 */
  static read(rom: Rom, gameCode: string): RegionMapRomData {
    const addresses = REGION_MAP_ADDRESSES[gameCode];
    if (!addresses) throw new RomError(`このゲームのタウンマップには対応していません: ${gameCode}`);
    return RegionMapReader.readAt(rom, addresses);
  }

  /** 位置を指定して読む。 */
  static readAt(rom: Rom, a: RegionMapAddresses): RegionMapRomData {
    const layoutsAt = a.layoutPointers.map((p) => rom.pointer(p));
    const layouts: number[][] = [];
    for (const at of layoutsAt) {
      for (let l = 0; l < REGION_MAP_LAYERS.length; l++) layouts.push([...rom.slice(at + l * REGION_MAP_CELLS, REGION_MAP_CELLS)]);
    }
    if (layouts.length !== REGION_MAP_PAGES.length * REGION_MAP_LAYERS.length) throw new RomError("タウンマップの面の数が違います");

    const positionsAt = rom.pointer(a.positionTablePointer);
    const sizesAt = rom.pointer(a.sizeTablePointer);
    const sections = [];
    for (let i = 0; i < MAPSEC_COUNT; i++) {
      sections.push({
        x: s16(rom.u16(positionsAt + i * 4)),
        y: s16(rom.u16(positionsAt + i * 4 + 2)),
        width: rom.u16(sizesAt + i * 4),
        height: rom.u16(sizesAt + i * 4 + 2),
      });
    }

    const flyAt = rom.pointer(a.flyDestinationTablePointer);
    const fly = [];
    for (let i = 0; i < FLY_DESTINATION_COUNT; i++) fly.push({ bank: rom.u8(flyAt + i * 3), map: rom.u8(flyAt + i * 3 + 1), heal: rom.u8(flyAt + i * 3 + 2) });

    const healAt = rom.pointer(a.healLocationTablePointer) + HEAL_LOCATION_SIZE;
    const heal = [];
    for (let i = 0; i < HEAL_LOCATION_COUNT; i++) {
      const at = healAt + i * HEAL_LOCATION_SIZE;
      heal.push({ bank: rom.u8(at), map: rom.u8(at + 1), x: s16(rom.u16(at + 2)), y: s16(rom.u16(at + 4)) });
    }

    const switches = new FlagSwitchReader(rom, a.eventFlagCheck);
    const mapFlagMap = switches.read(a.mapFlagFunction);
    const dungeonFlagMap = switches.read(a.dungeonFlagFunction);
    const flags = (m: Map<number, number>) => Array.from({ length: MAPSEC_COUNT }, (_, i) => m.get(MAPSEC_FIRST + i) ?? NO_FLAG);

    const namesAt = rom.pointer(a.nameTablePointer);
    const nameStrings: number[] = [];
    for (let i = 0; i < MAPSEC_NAMED_COUNT; i++) nameStrings.push(rom.pointer(namesAt + i * 4));

    const snapshot: RegionMapSnapshot = {
      layouts,
      sections,
      fly,
      heal,
      mapFlags: flags(mapFlagMap),
      dungeonFlags: flags(dungeonFlagMap),
    };
    const { graphics, source } = RegionMapGraphics.read(rom, a);
    return {
      document: new RegionMapDocument(snapshot),
      graphics,
      addresses: {
        layouts: layoutsAt,
        positions: positionsAt,
        sizes: sizesAt,
        names: namesAt,
        flyDestinations: flyAt,
        healLocations: healAt,
        nameStrings,
        graphics: source,
      },
    };
  }
}

function s16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

/** ROM 先頭からの位置を AdvanceMap の表示（`$3B5A48`）にする。 */
export function formatRomOffset(offset: number): string {
  return "$" + (offset >= ROM_BASE ? offset - ROM_BASE : offset).toString(16).toUpperCase();
}
