import { BLOCK_ID_MASK } from "../map/constants.js";
import type { Tileset } from "../map/types.js";
import { BLOCK_PIXELS, BlockRenderer } from "./BlockRenderer.js";
import { createImage, type RgbaImage } from "./color.js";

/** 描画に要るデータ（LoadedMap や MapDocument.toRenderable() の結果）。 */
export interface RenderableMap {
  readonly layout: { readonly width: number; readonly height: number; readonly blocks: Uint16Array };
  readonly primary: Tileset;
  readonly secondary: Tileset;
}

/** マップ 1 枚を RGBA 画像に描くクラス。ブロックの描画結果は保持して使い回す。 */
export class MapRenderer {
  private readonly blocks: BlockRenderer;

  constructor(private readonly map: RenderableMap) {
    this.blocks = new BlockRenderer(map.primary, map.secondary);
  }

  /**
   * マップ全体を描く。`grid` を渡すとその配置で描く（編集中の配置用）。
   * 省略時は ROM から読んだ配置を使う。
   */
  render(grid: Uint16Array = this.map.layout.blocks): RgbaImage {
    const { width, height } = this.map.layout;
    const image = createImage(width * BLOCK_PIXELS, height * BLOCK_PIXELS);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = grid[y * width + x] ?? 0;
        this.blocks.blit(cell & BLOCK_ID_MASK, image.data, image.width, x * BLOCK_PIXELS, y * BLOCK_PIXELS);
      }
    }
    return image;
  }

  /** 1 マスだけ描き直す（編集後の部分更新用）。 */
  renderCell(image: RgbaImage, x: number, y: number, cell: number): void {
    this.blocks.blit(cell & BLOCK_ID_MASK, image.data, image.width, x * BLOCK_PIXELS, y * BLOCK_PIXELS);
  }
}

/** マップ 1 枚を RGBA 画像に描く（MapRenderer の簡易版）。 */
export function renderMap(map: RenderableMap, grid?: Uint16Array): RgbaImage {
  return new MapRenderer(map).render(grid);
}
