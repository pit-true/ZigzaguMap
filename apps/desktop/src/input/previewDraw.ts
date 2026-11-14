import { BLOCK_PIXELS, createImage } from "@zigzagumap/core";
import type { TilesetView } from "../app/TilesetView";
import type { CellRect, FillCell } from "./paintPlans";
import type { PreviewPen } from "./PreviewCanvas";

/** 矩形塗りの下見の不透明度。 */
export const PREVIEW_ALPHA = 0.75;

/** マスの矩形の枠を引く（下見の Canvas に、主マップの左上を原点として）。 */
export function strokeCellRect(p: PreviewPen, r: CellRect, color: string): void {
  p.c.strokeStyle = color;
  p.c.lineWidth = 1;
  p.c.strokeRect(p.ox + r.x * p.size + 0.5, p.oy + r.y * p.size + 0.5, r.width * p.size - 1, r.height * p.size - 1);
}

/** ブロックを下見の Canvas に半透明で描く（矩形塗り・自動ペンの下見。`tiles` は主マップのタイルセット）。 */
export function drawPreviewBlocks(p: PreviewPen, tiles: TilesetView, cells: readonly FillCell[], alpha = PREVIEW_ALPHA): void {
  if (cells.length === 0) return;
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const w = Math.max(...cells.map((c) => c.x)) - minX + 1;
  const h = Math.max(...cells.map((c) => c.y)) - minY + 1;
  const image = createImage(w * BLOCK_PIXELS, h * BLOCK_PIXELS);
  for (const c of cells) tiles.renderer.blit(c.block, image.data, image.width, (c.x - minX) * BLOCK_PIXELS, (c.y - minY) * BLOCK_PIXELS);
  const tmp = document.createElement("canvas");
  tmp.width = image.width;
  tmp.height = image.height;
  tmp.getContext("2d")!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  p.c.save();
  p.c.imageSmoothingEnabled = false;
  p.c.globalAlpha = alpha;
  p.c.drawImage(tmp, p.ox + minX * p.size, p.oy + minY * p.size, w * p.size, h * p.size);
  p.c.restore();
}
