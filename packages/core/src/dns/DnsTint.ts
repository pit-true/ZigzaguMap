import { PRIMARY_PALETTE_COUNT } from "../map/constants.js";
import { fadeAt, timeOfDayAt, type DnsConfig, type DnsFade, type DnsLitTile, type TimeOfDay } from "./DnsConfig.js";

/**
 * 時間帯の色の計算（Phase6 #433）。CFRU の `src/dns.c` と同じ式で、パレットの色を変える。
 *
 * - 1 色: 成分（0〜31）ごとに `c + (((b − c) × k) >> 4)`。b は混ぜる色、k は係数。負の差は小さい方へ丸める
 *   （C の算術シフトと JavaScript の `>>` は同じ丸め）。
 * - 係数が `DNS_COEFF_HALVE_CHANNELS`（Chronos の朝）なら、混ぜる色の成分が 0 でなければそのまま、0 なら半分。
 * - 真っ黒（0x0000）は変えない。結果は 15 ビット（0x8000 のビットは落ちる）。
 * - 背景は `OW_BG_PAL_n` が真の本だけ、しかも 0〜12 だけ（`FadeOverworldBackground` が 13 本までしか回さない）。
 * - 夜は、光るタイル（`gSpecificTilesetFades`）の色を決まった色に置き換え、計算から外す。
 */

/** 色を変える 1 回分（係数と混ぜる色、半分の計算の係数の値）。 */
export interface DnsTint {
  readonly fade: DnsFade;
  /** `DNS_COEFF_HALVE_CHANNELS` の値（無ければ null）。 */
  readonly halveCoefficient: number | null;
}

/** 実機で背景の色を変えるパレットの数（0〜12。`dns.c` の `13 * 16`）。 */
const BG_FADE_PALETTES = 13;

/**
 * 16 色のパレットを受け取り、時間帯の色に変えた 16 色を返す関数の形（人物の絵・タイルアニメからも使う。#13 に知らせた）。
 * `palette` は実機のパレットの番号（OBJ なら 0〜15、背景なら 0〜15）。対象でない本はそのまま写して返す。
 */
export type PaletteTint = (colors: ArrayLike<number>, palette: number) => Uint16Array;

/** 1 色を変える。 */
export function tintColor(color: number, tint: DnsTint): number {
  if (color === 0) return 0;
  const { color: blend, amount } = tint.fade;
  const r = color & 0x1f;
  const g = (color >> 5) & 0x1f;
  const b = (color >> 10) & 0x1f;
  const br = blend & 0x1f;
  const bg = (blend >> 5) & 0x1f;
  const bb = (blend >> 10) & 0x1f;
  if (tint.halveCoefficient !== null && amount === tint.halveCoefficient) {
    return (br ? r : r >> 1) | ((bg ? g : g >> 1) << 5) | ((bb ? b : b >> 1) << 10);
  }
  return (
    ((r + (((br - r) * amount) >> 4)) & 0x1f) | (((g + (((bg - g) * amount) >> 4)) & 0x1f) << 5) | (((b + (((bb - b) * amount) >> 4)) & 0x1f) << 10)
  );
}

/** 何も変えない時刻か（係数 0 で、半分の計算でもない。昼）。 */
export function isNeutralTint(tint: DnsTint): boolean {
  return tint.fade.amount === 0 && tint.halveCoefficient !== 0;
}

/** 時間帯の区分の色（代表の時刻の 1 件）。 */
export function tintOf(config: DnsConfig, time: TimeOfDay): DnsTint {
  const section = config.sections.find((s) => s.id === time) ?? { hour: 12, minute: 0 };
  return { fade: fadeAt(config, section.hour, section.minute), halveCoefficient: config.halveCoefficient };
}

/** その区分が夜か（光るタイルを点ける。`IsNightTime`）。 */
export function isNightSection(config: DnsConfig, time: TimeOfDay): boolean {
  const section = config.sections.find((s) => s.id === time);
  return section !== undefined && timeOfDayAt(section.hour, config.starts) === "night";
}

/**
 * マップの種類（ヘッダーの 0x17）で、時間帯の色が変わるか。
 * 0・4（地下）・8（屋内）・9（秘密基地）は変えない。ほか（1〜3、5〜7、10 以上）は変える（`FadeDayNightPalettes`）。
 */
export function isTintedMapType(mapType: number): boolean {
  return mapType !== 0 && mapType !== 4 && mapType !== 8 && mapType !== 9;
}

/** その組（主と副のヘッダーの位置）に当たる光るタイル。 */
export function litTilesFor(config: Pick<DnsConfig, "litTiles">, primaryPointer: number, secondaryPointer: number): DnsLitTile[] {
  const p = primaryPointer >>> 0;
  const s = secondaryPointer >>> 0;
  return config.litTiles.filter((t) => t.tilesetPointer === p || t.tilesetPointer === s);
}

/**
 * タイルセットの 16 本 × 16 色（256 色。0〜6 は主、7〜15 は副から取ったもの）を変え、新しい配列を返す。
 * `bgMask` のビットが立った本（0〜12 だけ）を変える。`lit` の色は置き換えて計算から外す（夜だけ渡す）。
 */
export function tintTilesetPalettes(palettes: ArrayLike<number>, tint: DnsTint, bgMask: number, lit: readonly DnsLitTile[] = []): Uint16Array {
  const out = new Uint16Array(256);
  for (let i = 0; i < 256; i++) out[i] = palettes[i] ?? 0;
  const ignored = new Uint8Array(256);
  for (const t of lit) {
    for (const c of t.colors) {
      const i = t.palette * 16 + c.index;
      out[i] = c.color;
      ignored[i] = 1;
    }
  }
  for (let pal = 0; pal < BG_FADE_PALETTES; pal++) {
    if ((bgMask & (1 << pal)) === 0) continue;
    for (let c = 0; c < 16; c++) {
      const i = pal * 16 + c;
      if (!ignored[i]) out[i] = tintColor(out[i]!, tint);
    }
  }
  return out;
}

/** OBJ（人物の絵など）のパレット用の関数を作る。`OW_SPRITE_PAL_n` が偽の本と、黒はそのまま。 */
export function spritePaletteTint(config: Pick<DnsConfig, "spritePalettes">, tint: DnsTint): PaletteTint {
  return (colors, palette) => {
    const out = new Uint16Array(colors.length);
    const on = (config.spritePalettes & (1 << (palette & 0xf))) !== 0;
    for (let i = 0; i < colors.length; i++) out[i] = on ? tintColor(colors[i]!, tint) : colors[i]!;
    return out;
  };
}

/** 主・副タイルセットのパレットを、マップで読み込まれる 256 色の並び（0〜6 は主、7〜15 は副）にする（BlockRenderer と同じ取り方）。 */
export function tilesetPairPalettes(primary: ArrayLike<number>, secondary: ArrayLike<number>): Uint16Array {
  const out = new Uint16Array(256);
  for (let i = 0; i < 256; i++) out[i] = (i < PRIMARY_PALETTE_COUNT * 16 ? primary[i] : secondary[i]) ?? 0;
  return out;
}
