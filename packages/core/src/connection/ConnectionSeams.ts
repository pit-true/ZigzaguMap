import type { BlockGrid } from "../map/BlockGrid.js";
import { BLOCK_ID_MASK } from "../map/constants.js";
import type { MapId } from "../map/types.js";
import type { BlockRenderer } from "../render/BlockRenderer.js";
import { placeNeighbor, sideOf, type CellRect, type MapSize, type Side } from "./NeighborLayout.js";
import type { MapConnection } from "./types.js";

/**
 * 接続の境目から見える範囲（マス）。実機の画面は 15×10 タイル（約 7.5×5 ブロック）で、境目に立つと向こう側に
 * 横は 8 マス、縦は 6 マスほど見える（Bochi の安全点検と同じ値）。
 */
export const SEAM_VIEW = { horizontal: 8, vertical: 6 } as const;

/** 接続 1 本の点検の結果。 */
export interface SeamIssue {
  /** 主マップの接続の番号。 */
  readonly index: number;
  readonly direction: number;
  readonly side: Side;
  readonly id: MapId;
  /** 絵が変わるマス（主マップの左上が原点。主マップの外の、相手のマップのマス）。 */
  readonly cells: readonly { readonly x: number; readonly y: number }[];
}

/** 点検する相手 1 枚。 */
export interface SeamNeighbor {
  readonly grid: BlockGrid;
  /** 相手のブロックが、こちらのタイルセットの組で描くと違う絵になるか。 */
  differs(block: number): boolean;
}

/**
 * 接続の相手のマップのうち、境目から見える範囲（主マップを横 8・縦 6 マス広げた矩形の中）のマスを返す（相手のマップの中の座標）。
 * 上下左右の接続だけ。相手の大きさが 0 なら空。
 */
export function seamCells(main: MapSize, connection: Pick<MapConnection, "direction" | "offset">, size: MapSize): { x: number; y: number }[] {
  const placement = placeNeighbor(main, connection.direction, connection.offset, size);
  if (!placement || size.width <= 0 || size.height <= 0) return [];
  const view: CellRect = { x: -SEAM_VIEW.horizontal, y: -SEAM_VIEW.vertical, width: main.width + 2 * SEAM_VIEW.horizontal, height: main.height + 2 * SEAM_VIEW.vertical };
  const x0 = Math.max(placement.x, view.x);
  const y0 = Math.max(placement.y, view.y);
  const x1 = Math.min(placement.x + placement.width, view.x + view.width);
  const y1 = Math.min(placement.y + placement.height, view.y + view.height);
  const out: { x: number; y: number }[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push({ x: x - placement.x, y: y - placement.y });
  return out;
}

/**
 * 接続の境目の点検（#305。Bochi の安全点検のうち、接続先のタイルセットの組が違うときの絵の崩れ）。
 * 実機は、接続先のマップの見えている部分も今のマップのタイルセットで描く。相手のブロックがこちらの組では違う絵になるマスを数える。
 * `neighborOf` が null を返す接続（組が同じ・読めない）は点検しない。結果は崩れるマスのある接続だけ。
 */
export function findSeamIssues(
  main: MapSize & { readonly connections: readonly MapConnection[] | null | undefined },
  neighborOf: (connection: MapConnection, index: number) => SeamNeighbor | null,
): SeamIssue[] {
  const out: SeamIssue[] = [];
  (main.connections ?? []).forEach((c, index) => {
    const side = sideOf(c.direction);
    if (!side) return;
    const n = neighborOf(c, index);
    if (!n) return;
    const placement = placeNeighbor(main, c.direction, c.offset, n.grid)!;
    const cells: { x: number; y: number }[] = [];
    for (const p of seamCells(main, c, n.grid)) {
      const block = n.grid.cells[p.y * n.grid.width + p.x]! & BLOCK_ID_MASK;
      if (n.differs(block)) cells.push({ x: p.x + placement.x, y: p.y + placement.y });
    }
    if (cells.length > 0) out.push({ index, direction: c.direction, side, id: { bank: c.bank, map: c.map }, cells });
  });
  return out;
}

/**
 * 2 つのタイルセットの組で、ブロックの絵が違うかを答える関数を作る（答えは覚えておく）。
 * `mine` がこちらの組、`theirs` が相手の組。画素（RGBA）がすべて同じなら同じ絵。
 */
export function blockDiffer(mine: BlockRenderer, theirs: BlockRenderer): (block: number) => boolean {
  const memo = new Map<number, boolean>();
  return (block) => {
    let d = memo.get(block);
    if (d === undefined) {
      const a = mine.render(block);
      const b = theirs.render(block);
      d = false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          d = true;
          break;
        }
      }
      memo.set(block, d);
    }
    return d;
  };
}
