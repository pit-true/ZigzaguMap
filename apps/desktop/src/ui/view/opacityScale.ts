/**
 * 移動エリアの透明度（設定の `movementOpacity`、マップ側の重み 0〜1）と、スライダーの目盛り（0〜100）の変換。
 * 値の意味は AdvanceMap と同じ（0.3 なら移動許可の色 70%・マップ 30%）。
 */

/** スライダーの目盛りの数（0〜100 の 101 段）。 */
export const OPACITY_STEPS = 100;

/** 設定の値 → スライダーの位置（範囲外は端に丸める）。 */
export function sliderFromOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 0;
  return Math.round(Math.min(1, Math.max(0, opacity)) * OPACITY_STEPS);
}

/** スライダーの位置 → 設定の値（範囲外・数でない値は端か 0 に丸める）。 */
export function opacityFromSlider(position: number): number {
  if (!Number.isFinite(position)) return 0;
  return Math.min(OPACITY_STEPS, Math.max(0, Math.round(position))) / OPACITY_STEPS;
}

/** 表示する文字（「30%」）。 */
export function opacityText(opacity: number): string {
  return `${sliderFromOpacity(opacity)}%`;
}
