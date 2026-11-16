/**
 * 天候の色の段（weather.c の make_weather_fade_tbl・weather_fade・SoftFade）と、半透明の合成。
 * 段 1〜3 は曇り（BG を暗く）、4〜19 は雷の光。段 0 は元の色。
 */

/** 曇りの段の最大（FADE_CLOUD_MAX）。 */
export const FADE_CLOUD_MAX = 3;
/** 雷の段の最大（FADE_THUNDER_MAX）。 */
export const FADE_THUNDER_MAX = 19;
/** 霧の人物の色（MIST_RGB = RGB(28,31,28)）と寄せる係数（MIST_EVY）。 */
export const MIST_COLOR = 0x73fc;
export const MIST_EVY = 12;

/** 段ごとの 5bit の変換表（19 段 × 32 値）。BG 用と OBJ 用。 */
export interface WeatherFadeTables {
  readonly bg: Uint8Array;
  readonly obj: Uint8Array;
}

let cached: WeatherFadeTables | null = null;

/** make_weather_fade_tbl と同じ計算（u16 の値で、16 分の 1 ずつ）。 */
export function weatherFadeTables(): WeatherFadeTables {
  if (cached) return cached;
  const bg = new Uint8Array(FADE_THUNDER_MAX * 32), obj = new Uint8Array(FADE_THUNDER_MAX * 32);
  for (const [isObj, table] of [[false, bg], [true, obj]] as const) {
    for (let col = 0; col < 32; col++) {
      let fade = (col << 8) & 0xffff;
      let unit = isObj ? 0 : Math.floor((col << 8) / 16);
      let evy = 0;
      for (; evy < FADE_CLOUD_MAX; evy++) {
        fade = (fade - unit) & 0xffff;
        table[evy * 32 + col] = fade >> 8;
      }
      const base = fade;
      unit = Math.floor(((31 << 8) - fade) / 16) & 0xffff;
      for (; evy < FADE_THUNDER_MAX; evy++) {
        fade = (fade + unit) & 0xffff;
        if (col < 12) {
          // 暗い色は元の色を残し目にする
          const diff = ((fade - base) << 16) >> 16;
          if (diff > 0) fade = (fade - Math.trunc(diff / 2)) & 0xffff;
        }
        table[evy * 32 + col] = Math.min(31, fade >> 8);
      }
    }
  }
  cached = { bg, obj };
  return cached;
}

/** weather_fade の 1 本分（evy が 1 以上のときだけ変える）。`kind` 1 は BG 用、2 は OBJ 用、0 は変えない。 */
export function weatherFadeColors(colors: ArrayLike<number>, evy: number, kind: number): Uint16Array {
  const out = Uint16Array.from(colors);
  if (evy <= 0 || kind === 0) return out;
  const tables = weatherFadeTables();
  const table = kind === 2 ? tables.obj : tables.bg;
  const row = (Math.min(evy, FADE_THUNDER_MAX) - 1) * 32;
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    out[i] = table[row + (c & 31)]! | (table[row + ((c >> 5) & 31)]! << 5) | (table[row + ((c >> 10) & 31)]! << 10);
  }
  return out;
}

/** SoftFade（FADE_CHENJI）: 各色を `target` へ evy/16 寄せる。 */
export function softFadeColors(colors: ArrayLike<number>, evy: number, target: number): Uint16Array {
  const out = Uint16Array.from(colors);
  const channel = (c: number, t: number) => c + (((t - c) * evy) >> 4);
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    out[i] = channel(c & 31, target & 31) | (channel((c >> 5) & 31, (target >> 5) & 31) << 5) | (channel((c >> 10) & 31, (target >> 10) & 31) << 10);
  }
  return out;
}

/** GBA の半透明（BLDALPHA）: 5bit の値ごとに min(31, (上×eva＋下×evb)/16)。 */
export function blendChannel(top: number, bottom: number, eva: number, evb: number): number {
  return Math.min(31, (top * Math.min(16, eva) + bottom * Math.min(16, evb)) >> 4);
}

/** 色の段のかけ方（天候・CFRU か・素の表）。 */
export interface WeatherPaletteEffect {
  /** 段（0〜19）。 */
  readonly evy: number;
  /** 素の FR の霧（6）で、人物の色を MIST_COLOR へ寄せる。 */
  readonly fogTint: boolean;
  /** CFRU の GetDarkeningTypeBySlot（BG 0〜12 は BG 用、13〜15 は変えない、人物は OBJ 用）を使うか。 */
  readonly cfru: boolean;
  /** 素の FadeTblTypeDefault（32 バイト）。 */
  readonly fadeTypes: ArrayLike<number>;
}

/** 色を変えるか（段 0 で霧でもなければ変えない）。 */
export function weatherChangesPalettes(effect: WeatherPaletteEffect): boolean {
  return effect.evy > 0 || effect.fogTint;
}

/** マップの 256 色（BG 0〜15）に段をかける。 */
export function weatherBackgroundPalettes(colors: ArrayLike<number>, effect: WeatherPaletteEffect): Uint16Array {
  const out = Uint16Array.from(colors);
  if (effect.evy <= 0) return out;
  for (let p = 0; p < 16 && p * 16 < out.length; p++) {
    const kind = effect.cfru ? (p < 13 ? 1 : 0) : (effect.fadeTypes[p] ?? 0);
    out.set(weatherFadeColors(out.subarray(p * 16, p * 16 + 16), effect.evy, kind), p * 16);
  }
  return out;
}

/** 人物の 16 色（OBJ のパレットの番号 `slot`）に段と霧をかける。 */
export function weatherSpriteColors(colors: ArrayLike<number>, slot: number, effect: WeatherPaletteEffect): Uint16Array {
  const kind = effect.cfru ? 2 : (effect.fadeTypes[16 + (slot & 15)] ?? 2);
  const faded = weatherFadeColors(colors, effect.evy, kind);
  return effect.fogTint ? softFadeColors(faded, MIST_EVY, MIST_COLOR) : faded;
}

/** 天候の絵の 16 色（`(p-16) == compal_num` は OBJ 用の表）。 */
export function weatherObjectColors(colors: ArrayLike<number>, effect: WeatherPaletteEffect): Uint16Array {
  return weatherFadeColors(colors, effect.evy, 2);
}
