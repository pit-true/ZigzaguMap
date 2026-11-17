import { decodeBase64, encodeBase64 } from "@zigzagumap/core";
import type { MinimapImage } from "./protocol";

/** RGBA の画像を、送る形（base64）にする。 */
export function rgbaOf(image: { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray | Uint8Array }): MinimapImage {
  const d = image.data;
  return { width: image.width, height: image.height, rgba: encodeBase64(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)) };
}

/** 届いた画像を Canvas に描く（`canvas` を画像の大きさにする）。 */
export function drawMinimapImage(canvas: HTMLCanvasElement, image: MinimapImage): void {
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  data.set(decodeBase64(image.rgba));
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(data, image.width, image.height), 0, 0);
}
