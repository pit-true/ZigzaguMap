import type { RgbaImage } from "../render/color.js";
import type { Rom } from "../rom/Rom.js";
import { REGION_MAP_ADDRESSES } from "./addresses.js";
import { REGION_IMAGE_HEIGHT, REGION_IMAGE_WIDTH, REGION_MAP_CELL_PIXELS, REGION_MAP_HEIGHT, REGION_MAP_ORIGIN_X, REGION_MAP_ORIGIN_Y, REGION_MAP_WIDTH } from "./constants.js";
import { RegionMapGraphics } from "./RegionMapGraphics.js";

/** ツールバーのアイコンに切り出す大きさ（タウンマップの画素。枠を付けて 15×15 のドット絵にする）。 */
export const REGION_ICON_SIZE = 13;
/** 切り出す左上を、マサラタウンのマスの左上からずらす量（町の印の左に西の海岸と海、下に南の海が入る位置。FR の地図で決めた）。 */
const ICON_SHIFT_X = -7;
const ICON_SHIFT_Y = 1;
/** 位置の表が読めない・範囲外のときのマサラタウンのマス（FR の値）。 */
const DEFAULT_CELL = { x: 4, y: 11 };

/**
 * アイコンに切り出す範囲（カントーの面の画素）。`cell` は最初の地名（マサラタウン、0x58）のマス。
 * 位置はタウンマップのウィンドウと同じく、マス (x, y) の左上を (32 + x×8, 32 + y×8) とする。絵の外にはみ出さないように寄せる。
 */
export function regionIconArea(cell: { x: number; y: number }): { left: number; top: number; size: number } {
  const inside = cell.x >= 0 && cell.y >= 0 && cell.x < REGION_MAP_WIDTH && cell.y < REGION_MAP_HEIGHT;
  const c = inside ? cell : DEFAULT_CELL;
  const clamp = (v: number, max: number): number => Math.min(max - REGION_ICON_SIZE, Math.max(0, v));
  return {
    left: clamp(REGION_MAP_ORIGIN_X + c.x * REGION_MAP_CELL_PIXELS + ICON_SHIFT_X, REGION_IMAGE_WIDTH),
    top: clamp(REGION_MAP_ORIGIN_Y + c.y * REGION_MAP_CELL_PIXELS + ICON_SHIFT_Y, REGION_IMAGE_HEIGHT),
    size: REGION_ICON_SIZE,
  };
}

/**
 * ROM のタウンマップ（カントーの面）から、マサラタウンのあたりの 13×13 の画素を切り出す（ツールバーのワールドマップエディタのアイコン用。#541）。
 * 絵とマスの位置は、ワールドマップエディタ・タウンマップのウィンドウと同じ表（パレット・タイル・タイルマップ・位置の表）から読む。
 * 対応していないゲームか、読めなければ null。切り出した画素はメモリに持つだけで、ファイルには書かない。
 */
export function readRegionMapIcon(rom: Rom, gameCode: string): RgbaImage | null {
  const addresses = REGION_MAP_ADDRESSES[gameCode];
  if (!addresses) return null;
  try {
    const { graphics } = RegionMapGraphics.read(rom, addresses);
    const at = rom.pointer(addresses.positionTablePointer);
    const s16 = (v: number): number => (v << 16) >> 16;
    const area = regionIconArea({ x: s16(rom.u16(at)), y: s16(rom.u16(at + 2)) });
    return graphics.renderArea(0, area.left, area.top, area.size, area.size);
  } catch {
    return null;
  }
}
