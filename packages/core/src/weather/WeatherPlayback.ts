import type { PlaybackMarker } from "../script/playback/PlaybackState.js";
import { weatherFromHeader } from "./WeatherTypes.js";

/** 再生で天候が切り替わるフレームと、切り替わった先（中の番号）。 */
export interface WeatherChange {
  readonly frame: number;
  readonly weather: number;
}

/**
 * 天候の印から、doweather で切り替わる時を並べる（#498）。setweather は値を覚え（SetSav1Weather）、
 * resetweather はマップのヘッダーの値に戻し、doweather でその値へ徐々に切り替える（DoCurrentWeather）。
 */
export function weatherChanges(markers: readonly Pick<PlaybackMarker, "frame" | "weather">[], headerWeather: number, cycle = 0): WeatherChange[] {
  let saved = headerWeather;
  const out: WeatherChange[] = [];
  for (const marker of markers) {
    const w = marker.weather;
    if (!w) continue;
    if (w.command === "set") saved = w.value ?? saved;
    else if (w.command === "reset") saved = headerWeather;
    else out.push({ frame: marker.frame, weather: weatherFromHeader(saved, cycle) });
  }
  return out;
}
