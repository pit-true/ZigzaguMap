import { autoId } from "../../ui/form/controls";

/** 等倍の画素で描き、表示だけ `scale` 倍にする Canvas（AdvanceMap の 2 倍表示の TDXPaintBox）。 */
export function pixelCanvas(id: string, width: number, height: number, scale: number): HTMLCanvasElement {
  const c = autoId(document.createElement("canvas"), id);
  c.className = "pixel-canvas";
  resizePixelCanvas(c, width, height, scale);
  return c;
}

/** 大きさを変える（中身は消える）。 */
export function resizePixelCanvas(c: HTMLCanvasElement, width: number, height: number, scale: number): void {
  c.width = width;
  c.height = height;
  c.style.width = `${width * scale}px`;
  c.style.height = `${height * scale}px`;
}

/** RGBA を Canvas に写す。 */
export function putRgba(c: HTMLCanvasElement, data: Uint8ClampedArray<ArrayBuffer>): void {
  c.getContext("2d")!.putImageData(new ImageData(data, c.width, c.height), 0, 0);
}

/** マウスの位置を、Canvas の表示上の左上からの (x, y) にする。 */
export function pointIn(c: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } {
  const r = c.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
