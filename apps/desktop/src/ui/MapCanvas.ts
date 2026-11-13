import type { RgbaImage } from "@zigzagumap/core";

/** マップを描く Canvas。 */
export class MapCanvas {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "map-view";
    this.canvas = document.createElement("canvas");
    this.canvas.width = 0;
    this.canvas.height = 0;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D が使えません");
    this.context = context;
    this.element.append(this.canvas);
  }

  /** 画像を描く。 */
  draw(image: RgbaImage): void {
    if (this.canvas.width !== image.width || this.canvas.height !== image.height) {
      this.canvas.width = image.width;
      this.canvas.height = image.height;
    }
    this.context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }

  /** 何も描かない状態に戻す。 */
  clear(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
