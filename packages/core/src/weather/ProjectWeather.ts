import type { ProjectFs } from "../project/ProjectFs.js";
import { decodeIndexedPng } from "../project/png/PngDecoder.js";
import { stripCComments } from "../dns/cTable.js";

/**
 * CFRU のプロジェクトの「火山灰を白い砂嵐にする」設定（src/config.h の REPLACE_ASH_WEATHER_WITH_WHITE_SANDSTORM）と、
 * その色（graphics/Other/Hailstorm/HailstormWeather.png のパレット）。ROM のフックから引けないとき（ビルド前の ROM）に使う。
 */
export async function readProjectWhiteSandstorm(fs: ProjectFs): Promise<{ readonly enabled: boolean; readonly palette: Uint16Array | null }> {
  try {
    if (!await fs.exists("src/config.h")) return { enabled: false, palette: null };
    const config = stripCComments(await fs.readText("src/config.h"));
    const enabled = /^[ \t]*#define[ \t]+REPLACE_ASH_WEATHER_WITH_WHITE_SANDSTORM\b/m.test(config);
    if (!enabled) return { enabled, palette: null };
    const path = "graphics/Other/Hailstorm/HailstormWeather.png";
    if (!await fs.exists(path)) return { enabled, palette: null };
    const png = decodeIndexedPng(await fs.readBytes(path), fs.inflate);
    if (png.palette.length < 48) return { enabled, palette: null };
    const palette = Uint16Array.from({ length: 16 }, (_, i) => (png.palette[i * 3]! >> 3) | ((png.palette[i * 3 + 1]! >> 3) << 5) | ((png.palette[i * 3 + 2]! >> 3) << 10));
    return { enabled, palette };
  } catch { return { enabled: false, palette: null }; }
}
