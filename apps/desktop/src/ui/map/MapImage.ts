import { BLOCK_ID_MASK, BLOCK_PIXELS, createImage, type BlockGrid, type RgbaImage } from "@zigzagumap/core";
import type { TilesetView } from "../../app/TilesetView";

/** 書き換わった範囲（ピクセル）。 */
export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 覚えておく変更の数（これより古い変更から追いつくときは全体を描く）。 */
const HISTORY = 64;

/**
 * 表示中のマップのブロック画像。各タブの MapView が共有する。
 * 配置と描いた内容を比べ、変わったマスだけ描き直す（マップ全体は描き直さない）。
 */
export class MapImage {
  readonly image: RgbaImage;
  readonly imageData: ImageData;
  /** 描いたときのマスのブロック番号。 */
  private readonly drawn: Uint16Array;
  /** 何回変わったか。 */
  version = 0;
  private readonly changes: { version: number; rect: DirtyRect }[] = [];

  constructor(
    readonly grid: BlockGrid,
    readonly tiles: TilesetView,
  ) {
    this.image = createImage(grid.width * BLOCK_PIXELS, grid.height * BLOCK_PIXELS);
    this.imageData = new ImageData(this.image.data, this.image.width, this.image.height);
    this.drawn = new Uint16Array(grid.width * grid.height);
    for (let i = 0; i < this.drawn.length; i++) {
      const block = grid.cells[i]! & BLOCK_ID_MASK;
      this.drawn[i] = block;
      this.blit(i, block);
    }
  }

  get width(): number {
    return this.grid.width;
  }

  get height(): number {
    return this.grid.height;
  }

  /** 配置と見比べて、変わったマスを描き直す。変わった範囲を返す（無ければ null）。 */
  update(): DirtyRect | null {
    const w = this.grid.width;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    const cells = this.grid.cells;
    for (let i = 0; i < cells.length; i++) {
      const block = cells[i]! & BLOCK_ID_MASK;
      if (block === this.drawn[i]) continue;
      this.drawn[i] = block;
      this.blit(i, block);
      const x = i % w;
      const y = (i - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0) return null;
    const rect = {
      x: minX * BLOCK_PIXELS,
      y: minY * BLOCK_PIXELS,
      width: (maxX - minX + 1) * BLOCK_PIXELS,
      height: (maxY - minY + 1) * BLOCK_PIXELS,
    };
    this.version++;
    this.changes.push({ version: this.version, rect });
    if (this.changes.length > HISTORY) this.changes.shift();
    return rect;
  }

  /** `version` より後の変更をまとめた範囲。追いつけなければ全体、変更が無ければ null。 */
  dirtySince(version: number): DirtyRect | null {
    if (version === this.version) return null;
    const oldest = this.changes[0];
    if (!oldest || oldest.version > version + 1) return { x: 0, y: 0, width: this.image.width, height: this.image.height };
    let out: DirtyRect | null = null;
    for (const c of this.changes) {
      if (c.version <= version) continue;
      out = out ? union(out, c.rect) : { ...c.rect };
    }
    return out;
  }

  private blit(index: number, block: number): void {
    const x = index % this.grid.width;
    const y = (index - x) / this.grid.width;
    this.tiles.renderer.blit(block, this.image.data, this.image.width, x * BLOCK_PIXELS, y * BLOCK_PIXELS);
  }
}

function union(a: DirtyRect, b: DirtyRect): DirtyRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
