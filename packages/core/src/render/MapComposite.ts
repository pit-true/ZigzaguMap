import { placeNeighbor, sideOf, type CellRect, type MapSize } from "../connection/NeighborLayout.js";
import type { MapConnection } from "../connection/types.js";
import type { MapId } from "../map/types.js";

/** 1 枚の画像に並べるマップ 1 つ（座標は最初のマップの左上を (0, 0) としたマス）。 */
export interface CompositeMap {
  readonly id: MapId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 並べ方の結果。 */
export interface CompositeLayout {
  /** 並べたマップ（最初のマップが先頭。たどった順）。 */
  readonly maps: CompositeMap[];
  /** 全部を囲む矩形（マス）。 */
  readonly bounds: CellRect;
}

/** 並べるのに要る、マップの大きさと接続。 */
export type CompositeSource = MapSize & { readonly connections: readonly MapConnection[] | null | undefined };

/** 画像の辺の上限（画素）。これを超えるときは縮めるか聞く（Q15）。 */
export const COMPOSITE_MAX_SIDE = 16384;

/**
 * `start` から上下左右の接続をたどって、つながっているマップを全部並べる（ダイブ・浮上はたどらない。#246）。
 * 置き場所は接続の向きとずれから決める（隣のマップの帯と同じ）。同じマップに 2 回着いたら、最初の置き場所を使う。
 * 読めないマップは並べない。`maxMaps` を超えたらそこで止める。
 */
export async function layoutComposite(start: MapId, read: (id: MapId) => Promise<CompositeSource | null>, maxMaps = 1024): Promise<CompositeLayout> {
  const first = await read(start);
  if (!first) return { maps: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };
  const maps: CompositeMap[] = [{ id: start, x: 0, y: 0, width: first.width, height: first.height }];
  const seen = new Set<string>([`${start.bank}.${start.map}`]);
  const queue: [CompositeMap, CompositeSource][] = [[maps[0]!, first]];
  while (queue.length > 0 && maps.length < maxMaps) {
    const [at, src] = queue.shift()!;
    for (const c of src.connections ?? []) {
      if (!sideOf(c.direction)) continue;
      const id = { bank: c.bank, map: c.map };
      const k = `${id.bank}.${id.map}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const next = await read(id);
      if (!next) continue;
      const p = placeNeighbor({ width: at.width, height: at.height }, c.direction, c.offset, next)!;
      const placed = { id, x: at.x + p.x, y: at.y + p.y, width: next.width, height: next.height };
      maps.push(placed);
      queue.push([placed, next]);
      if (maps.length >= maxMaps) break;
    }
  }
  const x = Math.min(...maps.map((m) => m.x));
  const y = Math.min(...maps.map((m) => m.y));
  const right = Math.max(...maps.map((m) => m.x + m.width));
  const bottom = Math.max(...maps.map((m) => m.y + m.height));
  return { maps, bounds: { x, y, width: right - x, height: bottom - y } };
}

/** 画像の辺が上限に収まる、いちばん小さい縮め方（1・2・4・8…）。 */
export function compositeScale(bounds: CellRect, blockPixels: number, maxSide = COMPOSITE_MAX_SIDE): number {
  let scale = 1;
  while ((Math.max(bounds.width, bounds.height) * blockPixels) / scale > maxSide) scale *= 2;
  return scale;
}

/** 書き出しの「境界」「隣のマップの帯」で、マップの周りに足すマス（ゲームの画面で主人公の周りに見える分。Phase5 #403）。 */
export const EXPORT_PAD = { x: 7, y: 5 } as const;

/**
 * マップの画像の書き出し（#403）で描く範囲（マス。最初のマップの左上が原点）。
 * `whole` なら並べた全マップを囲む矩形、そうでなければ最初のマップ。`pad` を付けると周りに広げる。
 */
export function exportCrop(layout: CompositeLayout, whole: boolean, pad: { readonly x: number; readonly y: number } | null): CellRect {
  const first = layout.maps[0];
  const base = whole || !first ? layout.bounds : { x: first.x, y: first.y, width: first.width, height: first.height };
  if (!pad) return base;
  return { x: base.x - pad.x, y: base.y - pad.y, width: base.width + pad.x * 2, height: base.height + pad.y * 2 };
}

/** 2 つの矩形が重なるか。 */
export function rectsOverlap(a: CellRect, b: CellRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
