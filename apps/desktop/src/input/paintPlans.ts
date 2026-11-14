import { selectionWrites, type BlockSelection } from "../app/EditorState";
import type { Cell } from "../ui/map/MapView";

/** マス単位の矩形（両端を含む 2 点から作る）。 */
export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 2 点を両端に含む矩形。 */
export function rectOf(a: Cell, b: Cell): CellRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

/** 矩形塗りで 1 マスに書くもの（座標は主マップの左上が原点。外もありうる）。 */
export interface FillCell {
  readonly x: number;
  readonly y: number;
  readonly block: number;
  /** 選択が移動許可を持つときだけ。 */
  readonly movement?: number;
}

/**
 * 矩形塗り（Phase3 #233）: 矩形の中を選択で埋める。複数選択（スタンプ）は矩形の左上を基準にくり返して敷き詰める
 * （矩形の右端・下端で切れる分はそのまま切る）。四角でないスタンプの穴（`holes`）のマスは書かない。
 */
export function tileRect(rect: CellRect, s: BlockSelection): FillCell[] {
  const out: FillCell[] = [];
  for (let dy = 0; dy < rect.height; dy++) {
    for (let dx = 0; dx < rect.width; dx++) {
      const i = (dy % s.height) * s.width + (dx % s.width);
      if (!selectionWrites(s, i)) continue;
      const block = s.blocks[i] ?? 0;
      const movement = s.movements?.[i];
      out.push(movement === undefined ? { x: rect.x + dx, y: rect.y + dy, block } : { x: rect.x + dx, y: rect.y + dy, block, movement });
    }
  }
  return out;
}
