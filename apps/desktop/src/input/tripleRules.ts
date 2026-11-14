import type { BlockSelection } from "../app/EditorState";
import { jaPen } from "../i18n/ja.pen";

/**
 * 3 層のブロックの選び方と置けない規則（#300・#301）。
 * 3 層のブロック N の 3 枚目には次の番号 N+1 の下層が使われるので、N+1 は単独では置けない（SPEC）。
 * パレットでは N+1 を押すと N を選び、描く道具はどれも N+1 を書かない。
 */

/** 3 層の判定（TilesetView.triple の TripleLayerIndex を渡す）。 */
export interface TripleLookup {
  isTriple(block: number): boolean;
  isTripleChild(block: number): boolean;
  info(block: number): { readonly triple: boolean; readonly tripleChild: boolean; readonly unresolved: boolean };
}

/** パレットで押したブロック（3 層の次の番号なら 1 つ前の 3 層のブロック）。 */
export function paletteBlock(triple: TripleLookup | null, block: number): number {
  return triple?.isTripleChild(block) ? block - 1 : block;
}

/**
 * パレットの矩形の選択（Bochi と同じく、右端が 3 層なら 1 マス広げる）。入った 3 層の次の番号は書かないマスにする。
 * `blockAt` はパレットの (列, 行) のブロック（無い位置は null）。広げた先がパレットの外なら広げない。
 */
export function paletteRectSelection(
  rect: { x: number; y: number; w: number; h: number },
  blockAt: (col: number, row: number) => number | null,
  triple: TripleLookup | null,
  paletteWidth: number,
): BlockSelection {
  let w = rect.w;
  if (triple && rect.x + w < paletteWidth) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      const b = blockAt(rect.x + w - 1, y);
      if (b !== null && triple.isTriple(b)) {
        w++;
        break;
      }
    }
  }
  const blocks: number[] = [];
  const holes: boolean[] = [];
  let anyHole = false;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + w; x++) {
      const b = blockAt(x, y) ?? 0;
      blocks.push(b);
      const hole = triple?.isTripleChild(b) ?? false;
      holes.push(hole);
      anyHole ||= hole;
    }
  }
  return { width: w, height: rect.h, blocks, ...(anyHole ? { holes } : {}) };
}

/** ステータスバーのブロックの表示に足す文字（3 層・描けない 3 層・3 層の次の番号。どれでもなければ空）。 */
export function tripleStatusSuffix(triple: TripleLookup | null, block: number): string {
  if (!triple) return "";
  const info = triple.info(block);
  if (info.tripleChild) return jaPen.tripleChildSuffix(block - 1);
  if (info.unresolved) return jaPen.tripleUnresolvedSuffix;
  if (info.triple) return jaPen.tripleSuffix;
  return "";
}

/** 書くマスから 3 層の次の番号を落とす（#301）。`skipped` は落としたマスの数。 */
export function dropTripleChildren<T extends { readonly block: number }>(list: readonly T[], isChild: ((block: number) => boolean) | null): { kept: T[]; skipped: number } {
  if (!isChild) return { kept: [...list], skipped: 0 };
  const kept = list.filter((c) => !isChild(c.block));
  return { kept, skipped: list.length - kept.length };
}
