import { BLOCK_ID_MASK, BlockRenderer, renderBlocks, type MapId } from "@zigzagumap/core";
import type { ProjectSession } from "../../app/ProjectSession";
import { canvasOf } from "../canvas";

/** 行き先のまわりに描くブロックの数（7×7）。 */
export const WARP_PREVIEW_SIZE = 7;
/** 覚えておく画像の数。 */
const CACHE_SIZE = 8;

/** 行き先の周辺画像の答え。 */
export type WarpPreviewResult =
  | { readonly kind: "image"; readonly canvas: HTMLCanvasElement; readonly x: number; readonly y: number }
  | { readonly kind: "noMap" }
  | { readonly kind: "noWarp"; readonly count: number };

/**
 * ワープの行き先のまわり 7×7 ブロックの画像（#240）。行き先のマップは読み取り専用で読み（開いたマップの一覧に入れない）、
 * 最近の 8 枚だけ覚える。マップの外のマスは境界ブロック（ボーダー）を並べて描く。編集したら捨てる。
 */
export class WarpPreview {
  private readonly cache = new Map<string, Promise<WarpPreviewResult>>();

  /** 覚えた画像を捨てる。 */
  clear(): void {
    this.cache.clear();
  }

  /** 行き先 `target` のワープ `warpId` のまわりの画像。 */
  get(session: ProjectSession, target: MapId, warpId: number): Promise<WarpPreviewResult> {
    const key = `${target.bank}.${target.map}.${warpId}`;
    let found = this.cache.get(key);
    if (found) {
      // 最近使ったものを後ろへ
      this.cache.delete(key);
    } else {
      found = this.render(session, target, warpId);
      found.catch(() => this.cache.delete(key));
    }
    this.cache.set(key, found);
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return found;
  }

  private async render(session: ProjectSession, target: MapId, warpId: number): Promise<WarpPreviewResult> {
    if (!session.catalog.has(target)) return { kind: "noMap" };
    let doc;
    try {
      doc = await session.project.peek(target);
    } catch {
      return { kind: "noMap" };
    }
    const warps = doc.events?.warps ?? [];
    const warp = warps[warpId];
    if (!warp) return { kind: "noWarp", count: warps.length };
    const { primary, secondary } = await session.project.loadTilesets(doc);
    const renderer = new BlockRenderer(primary, secondary);
    const half = Math.floor(WARP_PREVIEW_SIZE / 2);
    const border = doc.border;
    const image = renderBlocks(renderer, WARP_PREVIEW_SIZE, WARP_PREVIEW_SIZE, (cx, cy) => {
      const x = warp.x - half + cx;
      const y = warp.y - half + cy;
      if (x >= 0 && y >= 0 && x < doc.width && y < doc.height) return doc.grid.getBlock(x, y);
      if (border.width === 0 || border.height === 0) return null;
      const bx = ((x % border.width) + border.width) % border.width;
      const by = ((y % border.height) + border.height) % border.height;
      return border.getCell(bx, by) & BLOCK_ID_MASK;
    });
    const canvas = canvasOf(image);
    // 行き先のマスを赤い枠で示す
    const c = canvas.getContext("2d")!;
    c.strokeStyle = "#ff0000";
    c.lineWidth = 2;
    c.strokeRect(half * 16 + 1, half * 16 + 1, 14, 14);
    return { kind: "image", canvas, x: warp.x, y: warp.y };
  }
}
