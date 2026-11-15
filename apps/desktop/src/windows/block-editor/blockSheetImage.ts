import { BLOCK_PIXELS, PRIMARY_BLOCK_COUNT, THIRD_LAYER_TILE_COUNT, bgr555ToRgb, isTripleLayer } from "@zigzagumap/core";
import type { TilesetModel } from "../TilesetModel";

/** 透明（色 0）の扱い。 */
export type BlockSheetBackground = "transparent" | "black" | "palette0";

/** ブロック一覧の画像の書き出しの選び方（#395）。 */
export interface BlockSheetOptions {
  /** タイルセット 2（副）か。 */
  readonly secondary: boolean;
  /** はじめと終わりの番号（タイルセットの中の番号。両端を含む）。 */
  readonly from: number;
  readonly to: number;
  /** 描くレイヤー（下層・上層・3 層目）。 */
  readonly lower: boolean;
  readonly upper: boolean;
  readonly third: boolean;
  /** 1 行のブロック数。 */
  readonly columns: number;
  readonly background: BlockSheetBackground;
}

/** 描いた画像（RGBA）。 */
export interface BlockSheetImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  /** 描いたブロックの数。 */
  readonly blocks: number;
}

/**
 * ブロック一覧の画像を描く。各ブロックは選んだレイヤーを下層 → 上層 → 3 層目の順に重ね、色 0 は透かす。
 * 下地は `background`（透明・黒・パレット 0 の色 0）。3 層目は 3 層のブロックだけ（次の番号の下層）。
 * 範囲はタイルセットのブロック数に丸める。
 */
export function renderBlockSheet(model: TilesetModel, o: BlockSheetOptions): BlockSheetImage {
  const count = o.secondary ? model.secondaryBlockCount : model.primaryBlockCount;
  const from = Math.max(0, Math.min(o.from, o.to));
  const to = Math.min(count - 1, Math.max(o.from, o.to));
  const n = Math.max(0, to - from + 1);
  const columns = Math.max(1, Math.min(64, Math.floor(o.columns)));
  const rows = Math.max(1, Math.ceil(n / columns));
  const width = columns * BLOCK_PIXELS;
  const height = rows * BLOCK_PIXELS;
  const data = new Uint8ClampedArray(width * height * 4);
  if (o.background !== "transparent") {
    const [r, g, b] = o.background === "black" ? [0, 0, 0] : bgr555ToRgb(model.palettes[0]!);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const base = o.secondary ? PRIMARY_BLOCK_COUNT : 0;
  for (let i = 0; i < n; i++) {
    const block = base + from + i;
    const tiles = model.blockTiles(block);
    if (!tiles) continue;
    const x = (i % columns) * BLOCK_PIXELS;
    const y = Math.floor(i / columns) * BLOCK_PIXELS;
    const draw = (refs: readonly number[]): void => {
      refs.forEach((ref, k) => model.drawTileRef(data, width, ref, x + (k & 1) * 8, y + (k & 2) * 4, true));
    };
    if (o.lower) draw(tiles.slice(0, 4));
    if (o.upper) draw(tiles.slice(4, 8));
    if (o.third && isTripleLayer(model.attribute(block)) && model.owner(block + 1)?.data === model.owner(block)?.data) {
      draw(model.blockTiles(block + 1)?.slice(0, THIRD_LAYER_TILE_COUNT) ?? []);
    }
  }
  return { width, height, data, blocks: n };
}
