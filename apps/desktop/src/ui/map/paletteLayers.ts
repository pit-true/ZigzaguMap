import type { BlockSelection } from "../../app/EditorState";
import type { TilesetView } from "../../app/TilesetView";
import { shadeTripleChild } from "../tripleLayerShade";

/**
 * ブロックパレットに重ねて描く段（下から順）。
 * - `blocks`: ブロックの絵の Canvas に等倍で描く（パレットを作り直すときだけ。3 層の次の番号の印）。
 * - `grid`: グリッドの Canvas に表示の大きさで描く（パレットを作り直すときだけ。TS1 と TS2 の境目。#308）。
 *   等倍でグリッドを出さないときは、グリッドの Canvas を持たずブロックの絵の上に描く。
 * - `overlay`: 選択の枠の Canvas に、枠の下に描く（選択や設定が変わるたびに描き直す。オートペンで描けるブロックの色。#310）。
 * 選択の枠はいちばん上に BlockPaletteView が描く。
 */
export type PaletteLayerPass = "blocks" | "grid" | "overlay";

/** 描くときに渡すパレットの形。 */
export interface PaletteGeometry {
  /** 1 マスの大きさ（`blocks` の段は BLOCK_PIXELS、ほかは表示の大きさ）。 */
  readonly size: number;
  /** 1 行のブロック数。 */
  readonly width: number;
  /** パレットに並ぶブロックの数（主の 640 個と副の分）。 */
  readonly count: number;
  /** ブロックのパレット上の (列, 行)。 */
  cellOf(block: number): { col: number; row: number };
}

/** 重ねて描くもの。 */
export type PaletteLayer = (c: CanvasRenderingContext2D, g: PaletteGeometry) => void;

/**
 * 3 層の次の番号（単独では置けないブロック。#300）の絵を薄くして灰色の斜線を引く（Q4 の推奨）。`blocks` の段。
 * ブロックエディタの一覧・マップ作成補助の一覧と同じ見せ方（shadeTripleChild。#387 でそろえた）。
 */
export function tripleChildLayer(tiles: TilesetView): PaletteLayer {
  return (ctx, g) => {
    const s = g.size;
    for (let block = 0; block < g.count; block++) {
      if (!tiles.triple.isTripleChild(block)) continue;
      const p = g.cellOf(block);
      const image = ctx.getImageData(p.col * s, p.row * s, s, s);
      shadeTripleChild(image.data, s, 0, 0);
      ctx.putImageData(image, p.col * s, p.row * s);
    }
  };
}

/** 枠の矩形（パレットのマス単位）。 */
export interface PaletteRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 選択の赤い枠を描く。`dragging` を渡すとドラッグ中の矩形を描く。選んだ矩形がパレットの並びのとおりでなければ
 * （マップから拾ったスタンプなど）枠は出さない。3 層のブロックを 1 つ選んでいるときは、次の番号まで 2 マス分の枠にする。
 */
export function drawPaletteSelection(c: CanvasRenderingContext2D, tiles: TilesetView, g: PaletteGeometry, selection: BlockSelection | null, dragging: PaletteRect | null): void {
  let r = dragging;
  if (!r && selection) {
    const s = selection;
    const p = g.cellOf(s.blocks[0] ?? 0);
    if (s.width === 1 && s.height === 1) {
      r = { x: p.col, y: p.row, w: 1, h: 1 };
    } else {
      // パレットから選んだ矩形なら、左上のブロックの位置から枠を出す。
      const fits = s.blocks.every((b, i) => {
        const q = g.cellOf(b);
        return q.col === p.col + (i % s.width) && q.row === p.row + Math.floor(i / s.width);
      });
      if (fits) r = { x: p.col, y: p.row, w: s.width, h: s.height };
    }
  }
  if (!r) return;
  const size = g.size;
  c.strokeStyle = "#ff0000";
  c.lineWidth = 1;
  const single = !dragging && selection && selection.width === 1 && selection.height === 1;
  const third = single ? tiles.triple.thirdOf(selection!.blocks[0] ?? 0) : null;
  if (third !== null) {
    // 3 層のブロック: 次の番号まで 2 マス分の枠（行の端で折り返すときは 2 つの枠）
    const q = g.cellOf(third);
    if (q.row === r.y && q.col === r.x + 1) {
      c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, 2 * size - 1, size - 1);
    } else {
      c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, size - 1, size - 1);
      c.strokeRect(q.col * size + 0.5, q.row * size + 0.5, size - 1, size - 1);
    }
    return;
  }
  c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, r.w * size - 1, r.h * size - 1);
}

