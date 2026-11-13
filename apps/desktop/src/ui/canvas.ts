import type { RgbaImage } from "@zigzagumap/core";

/** RGBA の画像を ImageData にする（バイト列は写さずに共有する）。 */
export function toImageData(image: RgbaImage): ImageData {
  return new ImageData(image.data, image.width, image.height);
}

/** Canvas を画像の大きさにして、画像をそのまま描く。 */
export function drawRgba(canvas: HTMLCanvasElement, image: RgbaImage): void {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(toImageData(image), 0, 0);
}

/** 画像を描いた新しい Canvas。 */
export function canvasOf(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  drawRgba(canvas, image);
  return canvas;
}
