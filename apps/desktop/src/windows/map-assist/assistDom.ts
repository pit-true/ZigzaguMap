import { decodeBase64 } from "@zigzagumap/core";
import type { AssistImage } from "./protocol";

/** ブロック 1 つの画素。 */
export const BLOCK = 16;
/** パレットの 1 行のブロック数。 */
export const PALETTE_WIDTH = 8;
/** 主タイルセットのブロック数。 */
const PRIMARY = 640;

/** パレットの (列, 行) のブロック（無い位置は null）。 */
export function paletteBlock(col: number, row: number, secondaryCount: number): number | null {
  if (col < 0 || col >= PALETTE_WIDTH || row < 0) return null;
  const primaryRows = PRIMARY / PALETTE_WIDTH;
  if (row < primaryRows) return row * PALETTE_WIDTH + col;
  const i = (row - primaryRows) * PALETTE_WIDTH + col;
  return i < secondaryCount ? PRIMARY + i : null;
}

/** ブロックのパレット上の (列, 行)。 */
export function palettePos(block: number): { col: number; row: number } {
  if (block < PRIMARY) return { col: block % PALETTE_WIDTH, row: Math.floor(block / PALETTE_WIDTH) };
  const i = block - PRIMARY;
  return { col: i % PALETTE_WIDTH, row: PRIMARY / PALETTE_WIDTH + Math.floor(i / PALETTE_WIDTH) };
}

/** 届いた画像を Canvas にする（`edit` で画素を描き足せる）。 */
export function imageCanvas(image: AssistImage, edit?: (rgba: Uint8ClampedArray, width: number) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const rgba = new Uint8ClampedArray(decodeBase64(image.rgba));
  edit?.(rgba, image.width);
  c.getContext("2d")!.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  return c;
}

// ---- 部品（自動操作の ID は data-auto-id） ----

export function div(className: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

export function canvasEl(id: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.dataset["autoId"] = id;
  return c;
}

export function buttonEl(id: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.dataset["autoId"] = id;
  b.addEventListener("click", onClick);
  return b;
}

export function labelEl(text: string): HTMLElement {
  const l = document.createElement("div");
  l.className = "assist-label";
  l.textContent = text;
  return l;
}

export function checkbox(id: string, checked: boolean): HTMLInputElement {
  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = checked;
  c.dataset["autoId"] = id;
  return c;
}

export function withLabel(input: HTMLInputElement, text: string): HTMLElement {
  const l = document.createElement("label");
  l.append(input, document.createTextNode(text));
  return l;
}
