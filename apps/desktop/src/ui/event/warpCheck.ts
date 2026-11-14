import { BLOCK_ID_MASK, PRIMARY_BLOCK_COUNT, isWarpBehavior, type MapDocument } from "@zigzagumap/core";
import type { TilesetView } from "../../app/TilesetView";

/** ブロックの属性（u32）。タイルセットに無い番号なら null。 */
export function blockAttribute(tiles: TilesetView, block: number): number | null {
  const id = block & BLOCK_ID_MASK;
  const attrs = id < PRIMARY_BLOCK_COUNT ? tiles.primary.attributes : tiles.secondary.attributes;
  const v = attrs[id < PRIMARY_BLOCK_COUNT ? id : id - PRIMARY_BLOCK_COUNT];
  return v === undefined ? null : v;
}

/**
 * ワープできないブロックの上にあるワープの番号（#240）。乗っているブロックの挙動がワープ・ドア・階段・はしご・
 * エスカレーターなど（core の WARP_BEHAVIORS）に当たらないもの。マップの外のワープは調べない（外の帯で知らせている）。
 */
export function unusableWarps(doc: MapDocument, tiles: TilesetView): number[] {
  const out: number[] = [];
  const warps = doc.events?.warps ?? [];
  warps.forEach((w, i) => {
    if (w.x >= doc.width || w.y >= doc.height) return;
    const attr = blockAttribute(tiles, doc.grid.getBlock(w.x, w.y));
    if (attr !== null && !isWarpBehavior(attr)) out.push(i);
  });
  return out;
}

/** 箱の右上に警告の印（黄色の三角に「!」）を描く。 */
export function drawWarpWarnings(canvas: HTMLCanvasElement, cells: readonly { x: number; y: number }[], cellSize: number): void {
  if (cells.length === 0) return;
  const c = canvas.getContext("2d")!;
  const s = cellSize / 16;
  for (const cell of cells) {
    const x = cell.x * cellSize + cellSize - 9 * s;
    const y = cell.y * cellSize;
    c.fillStyle = "#ffd400";
    c.strokeStyle = "#000000";
    c.lineWidth = s;
    c.beginPath();
    c.moveTo(x + 4.5 * s, y + 0.5 * s);
    c.lineTo(x + 8.5 * s, y + 7.5 * s);
    c.lineTo(x + 0.5 * s, y + 7.5 * s);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = "#000000";
    c.fillRect(x + 4 * s, y + 2.5 * s, s, 3 * s);
    c.fillRect(x + 4 * s, y + 6 * s, s, s);
  }
}
