import {
  FLY_DESTINATION_COUNT,
  HEAL_LOCATION_COUNT,
  MAPSEC_COUNT,
  MAPSEC_FIRST,
  NO_FLAG,
  REGION_MAP_CELLS,
  REGION_MAP_LAYERS,
  REGION_MAP_PAGES,
  REGION_MAP_WIDTH,
  hasFlyDestination,
  isRegionSection,
  type RegionMapLayer,
  type RegionMapPage,
} from "./constants.js";

/** 地名ごとの位置と大きさ（マス単位）。 */
export interface RegionSection {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 空を飛ぶの行き先（WarpPosition の 1 件）。`heal` が 0 以外なら飛び先（回復地点）の番号を使う。 */
export interface FlyDestination {
  bank: number;
  map: number;
  heal: number;
}

/** 飛び先（回復地点）1 件。 */
export interface HealLocation {
  bank: number;
  map: number;
  x: number;
  y: number;
}

/** 編集できる表をすべて写したもの（JSON にでき、取り消しの控えと別ウィンドウへの受け渡しに使う）。 */
export interface RegionMapSnapshot {
  /** 面 × レイヤーの地名の表（`面番号 * 2 + レイヤー番号` の順、各 15×22）。 */
  layouts: number[][];
  /** 地名 0x58〜0xC5 の位置と大きさ。 */
  sections: RegionSection[];
  /** 地名 0x58〜0xC3 の空を飛ぶの行き先。 */
  fly: FlyDestination[];
  /** 飛び先 1〜20。 */
  heal: HealLocation[];
  /** 地名 0x58〜0xC5 の人ID（基本レイヤー。無ければ 0xFFFF）。 */
  mapFlags: number[];
  /** 地名 0x58〜0xC5 の人ID（トップレイヤー）。 */
  dungeonFlags: number[];
}

/** 面とレイヤーから表の番号。 */
export function layoutIndex(page: RegionMapPage | number, layer: RegionMapLayer | number): number {
  const p = typeof page === "number" ? page : REGION_MAP_PAGES.indexOf(page);
  const l = typeof layer === "number" ? layer : REGION_MAP_LAYERS.indexOf(layer);
  return p * REGION_MAP_LAYERS.length + l;
}

/**
 * タウンマップの編集できる表（地名の配置・位置と大きさ・空を飛ぶの行き先・飛び先・人ID）。
 * 絵（タイル・パレット）は RegionMapGraphics で、ここには持たない。
 */
export class RegionMapDocument {
  private data: RegionMapSnapshot;

  constructor(snapshot: RegionMapSnapshot) {
    RegionMapDocument.check(snapshot);
    this.data = clone(snapshot);
  }

  /** 地名の配置（ある面・レイヤーのマス）。 */
  cell(page: number, layer: number, x: number, y: number): number {
    return this.data.layouts[layoutIndex(page, layer)]![y * REGION_MAP_WIDTH + x]!;
  }

  setCell(page: number, layer: number, x: number, y: number, value: number): void {
    this.data.layouts[layoutIndex(page, layer)]![y * REGION_MAP_WIDTH + x] = value;
  }

  /** 地名の配置の 1 枚（コピー）。 */
  layout(page: number, layer: number): number[] {
    return this.data.layouts[layoutIndex(page, layer)]!.slice();
  }

  /** 地名の位置と大きさ。表の範囲外なら null。 */
  section(id: number): RegionSection | null {
    return isRegionSection(id) ? { ...this.data.sections[id - MAPSEC_FIRST]! } : null;
  }

  setSection(id: number, value: RegionSection): void {
    this.data.sections[id - MAPSEC_FIRST] = { ...value };
  }

  /** 空を飛ぶの行き先。表の範囲外なら null。 */
  flyDestination(id: number): FlyDestination | null {
    return hasFlyDestination(id) ? { ...this.data.fly[id - MAPSEC_FIRST]! } : null;
  }

  setFlyDestination(id: number, value: FlyDestination): void {
    this.data.fly[id - MAPSEC_FIRST] = { ...value };
  }

  /** 飛び先（1〜20）。範囲外なら null。 */
  healLocation(index: number): HealLocation | null {
    return index >= 1 && index <= HEAL_LOCATION_COUNT ? { ...this.data.heal[index - 1]! } : null;
  }

  setHealLocation(index: number, value: HealLocation): void {
    this.data.heal[index - 1] = { ...value };
  }

  /** 人ID（訪問フラグ）。表の範囲外なら NO_FLAG。 */
  flag(layer: RegionMapLayer | number, id: number): number {
    if (!isRegionSection(id)) return NO_FLAG;
    const list = layerIndex(layer) === 0 ? this.data.mapFlags : this.data.dungeonFlags;
    return list[id - MAPSEC_FIRST]!;
  }

  setFlag(layer: RegionMapLayer | number, id: number, flag: number): void {
    const list = layerIndex(layer) === 0 ? this.data.mapFlags : this.data.dungeonFlags;
    list[id - MAPSEC_FIRST] = flag;
  }

  /** 地名が置かれているマスを探す（面・レイヤーの順、上の行から）。無ければ null。 */
  find(id: number, layer?: number): { page: number; layer: number; x: number; y: number } | null {
    for (let p = 0; p < REGION_MAP_PAGES.length; p++) {
      for (let l = 0; l < REGION_MAP_LAYERS.length; l++) {
        if (layer !== undefined && l !== layer) continue;
        const i = this.data.layouts[layoutIndex(p, l)]!.indexOf(id);
        if (i >= 0) return { page: p, layer: l, x: i % REGION_MAP_WIDTH, y: Math.floor(i / REGION_MAP_WIDTH) };
      }
    }
    return null;
  }

  /** 全体の写し。 */
  snapshot(): RegionMapSnapshot {
    return clone(this.data);
  }

  /** 写しに戻す。 */
  restore(snapshot: RegionMapSnapshot): void {
    RegionMapDocument.check(snapshot);
    this.data = clone(snapshot);
  }

  /** 複製。 */
  clone(): RegionMapDocument {
    return new RegionMapDocument(this.data);
  }

  /** 内容が同じか。 */
  equals(other: RegionMapDocument): boolean {
    return JSON.stringify(this.data) === JSON.stringify(other.data);
  }

  /** 写しの形と数を確かめる。違えば Error。 */
  static check(s: RegionMapSnapshot): void {
    const ok =
      s.layouts.length === REGION_MAP_PAGES.length * REGION_MAP_LAYERS.length &&
      s.layouts.every((l) => l.length === REGION_MAP_CELLS) &&
      s.sections.length === MAPSEC_COUNT &&
      s.fly.length === FLY_DESTINATION_COUNT &&
      s.heal.length === HEAL_LOCATION_COUNT &&
      s.mapFlags.length === MAPSEC_COUNT &&
      s.dungeonFlags.length === MAPSEC_COUNT;
    if (!ok) throw new Error("タウンマップの表の大きさが違います");
  }
}

function layerIndex(layer: RegionMapLayer | number): number {
  return typeof layer === "number" ? layer : REGION_MAP_LAYERS.indexOf(layer);
}

function clone(s: RegionMapSnapshot): RegionMapSnapshot {
  return {
    layouts: s.layouts.map((l) => l.slice()),
    sections: s.sections.map((v) => ({ x: v.x, y: v.y, width: v.width, height: v.height })),
    fly: s.fly.map((v) => ({ bank: v.bank, map: v.map, heal: v.heal })),
    heal: s.heal.map((v) => ({ bank: v.bank, map: v.map, x: v.x, y: v.y })),
    mapFlags: s.mapFlags.slice(),
    dungeonFlags: s.dungeonFlags.slice(),
  };
}
