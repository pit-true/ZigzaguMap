import type { RgbaImage } from "../render/color.js";
import type { WeatherObjectGraphics } from "./WeatherGraphics.js";
import type { WeatherDraw } from "./WeatherSimulation.js";
import { blendChannel } from "./WeatherPalette.js";

/** 描く 1 つ分（絵と、その時の 16 色）。 */
export interface WeatherLayerItem {
  readonly draw: WeatherDraw;
  readonly graphics: WeatherObjectGraphics;
  readonly colors: ArrayLike<number>;
}

let buffer = new Int32Array(0);

/**
 * 天候の OBJ を `target` に重ねる。GBA の OBJ の面と同じく、重なった所は先の項目（OAM の若い番号）だけが残り、
 * 半透明の絵は下の画素と BLDALPHA（eva・evb）で混ぜる。OAM の座標は 9bit・8bit で折り返す。
 */
export function drawWeatherLayer(target: RgbaImage, items: readonly WeatherLayerItem[], eva: number, evb: number): void {
  if (!items.length) return;
  const width = target.width, height = target.height, size = width * height;
  if (buffer.length < size) buffer = new Int32Array(size);
  const layer = buffer.subarray(0, size);
  layer.fill(-1);
  let any = false;
  for (const { draw, graphics, colors } of items) {
    const x9 = draw.x & 511, y8 = draw.y & 255;
    const left = x9 >= 256 ? x9 - 512 : x9;
    const top = y8 >= 160 ? y8 - 256 : y8;
    const w = draw.width, h = draw.height, tilesX = w >> 3;
    const base = graphics.transfer ? draw.frame * (graphics.width * graphics.height >> 6) : draw.frame;
    const semi = graphics.semiTransparent ? 0x10000 : 0;
    for (let py = Math.max(0, -top); py < Math.min(h, height - top); py++) {
      const row = (top + py) * width;
      for (let px = Math.max(0, -left); px < Math.min(w, width - left); px++) {
        const at = row + left + px;
        if (layer[at] !== -1) continue;
        const tile = base + (py >> 3) * tilesX + (px >> 3);
        if (tile >= graphics.tileCount) continue;
        const index = graphics.tiles[(tile << 6) + ((py & 7) << 3) + (px & 7)]!;
        if (!index) continue;
        layer[at] = (colors[index]! & 0x7fff) | semi;
        any = true;
      }
    }
  }
  if (!any) return;
  const d = target.data;
  for (let i = 0; i < size; i++) {
    const v = layer[i]!;
    if (v === -1) continue;
    let r = v & 31, g = (v >> 5) & 31, b = (v >> 10) & 31;
    const o = i * 4;
    if (v & 0x10000) {
      r = blendChannel(r, d[o]! >> 3, eva, evb);
      g = blendChannel(g, d[o + 1]! >> 3, eva, evb);
      b = blendChannel(b, d[o + 2]! >> 3, eva, evb);
    }
    d[o] = (r << 3) | (r >> 2); d[o + 1] = (g << 3) | (g >> 2); d[o + 2] = (b << 3) | (b >> 2); d[o + 3] = 255;
  }
}

/** 重ねる所の作業用の領域を捨てる（天候の表示を止めたとき）。 */
export function releaseWeatherLayerBuffer(): void {
  buffer = new Int32Array(0);
}

/**
 * 同じ BG の優先度の人物との前後。霧・霧2・雲は人物より奥（actpri 255）、ほかは手前。
 * 人物の画素がある所には奥の天候の絵を描かない（GBA の OBJ の面は 1 枚）。
 */
export function weatherBehindActors(kind: WeatherObjectGraphics["kind"]): boolean {
  return kind === "fog" || kind === "fogDiagonal" || kind === "cloud";
}
