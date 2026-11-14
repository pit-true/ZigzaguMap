import { BLOCK_PIXELS, PRIMARY_BLOCK_COUNT } from "@zigzagumap/core";
import { jaPaletteInfo as t } from "../../i18n/ja.paletteInfo";

/** 境目の線と見出しの色。 */
const LINE_COLOR = "#ff8000";
const LABEL_BG = "rgba(0, 0, 0, 0.65)";
const LABEL_TEXT = "#ffffff";

/**
 * ブロックパレットのタイルセット 1 と 2 の境目（#308。Bochi のパレットの見出し）。副の最初の行の上に線を引き、
 * 左上に「TS2 0x280〜」の見出しを出す。`size` は 1 マスの表示の大きさ、`width` は 1 行のブロック数。
 */
export function drawPaletteBoundary(c: CanvasRenderingContext2D, size: number, width: number): void {
  const row = Math.ceil(PRIMARY_BLOCK_COUNT / width);
  const y = row * size;
  if (y <= 0 || y >= c.canvas.height) return;
  const line = Math.max(2, Math.round(size / 8));
  c.save();
  c.fillStyle = LINE_COLOR;
  c.fillRect(0, y - Math.floor(line / 2), c.canvas.width, line);
  const fontPx = Math.max(9, Math.round((size * 9) / BLOCK_PIXELS));
  c.font = `bold ${fontPx}px "MS UI Gothic", sans-serif`;
  c.textBaseline = "top";
  const w = c.measureText(t.boundaryLabel).width + 6;
  c.fillStyle = LABEL_BG;
  c.fillRect(0, y + Math.ceil(line / 2), w, fontPx + 3);
  c.fillStyle = LABEL_TEXT;
  c.fillText(t.boundaryLabel, 3, y + Math.ceil(line / 2) + 2);
  c.restore();
}
