/**
 * 天候の番号（FR 日本語版 weather.h の WEATHER_*。ヘッダーの値は wea_ctrl.c の convert_weather_code で変わる）。
 * #498 の調べた結果: issue のコメント。
 */
export const WEATHER = {
  NONE: 0,
  CLOUDS: 1,
  SUNNY: 2,
  RAIN: 3,
  SNOW: 4,
  THUNDER: 5,
  FOG: 6,
  ASH: 7,
  SANDSTORM: 8,
  FOG_DIAGONAL: 9,
  UNDERWATER: 10,
  SHADE: 11,
  DROUGHT: 12,
  HEAVY_RAIN: 13,
  BUBBLES: 14,
} as const;

/** 中の天候の数（0〜14）。 */
export const WEATHER_COUNT = 15;

/** 日ごとに変わる天候（ID_WEATHER_SRTR・SSRS）。周期 0〜3。 */
const CYCLES: Readonly<Record<number, readonly number[]>> = {
  20: [WEATHER.SUNNY, WEATHER.RAIN, WEATHER.THUNDER, WEATHER.RAIN],
  21: [WEATHER.SUNNY, WEATHER.SUNNY, WEATHER.RAIN, WEATHER.SUNNY],
};

/** ヘッダー・setweather の値を中の番号にする（0〜14 はそのまま、20・21 は周期、ほかはなし）。 */
export function weatherFromHeader(value: number, cycle = 0): number {
  if (Number.isInteger(value) && value >= 0 && value < WEATHER_COUNT) return value;
  const table = CYCLES[value];
  return table ? table[((cycle % 4) + 4) % 4]! : WEATHER.NONE;
}

/** 雨の仲間（IS_RAINY_WEATHER）。雨どうしの切り替えでは雨粒を消さない。 */
export function isRainyWeather(weather: number): boolean {
  return weather === WEATHER.RAIN || weather === WEATHER.THUNDER || weather === WEATHER.HEAVY_RAIN;
}
