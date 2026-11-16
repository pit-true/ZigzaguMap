import type { Tileset } from "@zigzagumap/core";

/**
 * 今の時間帯の色（Phase6 #434）。昼のときは null で、描画は今までと同じ道を通る。
 * 色の計算の部品（core の dns）は、初めて昼以外にしたときに `TimeOfDayView` が読み込んで、ここへ入れる。
 * ここは型と入れ物だけで、dns の部品を読み込まない（起動の時間を変えないため）。
 */
export interface ActiveTint {
  /** 切り替えるたびに増える番号（描いた絵のキャッシュの鍵に入れる）。 */
  readonly generation: number;
  /** そのマップの種類（ヘッダーの 0x17）で色を変えるか（屋内・地下・秘密基地などは変えない）。 */
  tintsMapType(mapType: number): boolean;
  /** タイルセットの組（主と副のヘッダーの位置）の 256 色を変えたもの。光るタイルも入れる。 */
  palettes(primaryPointer: number, secondaryPointer: number, primary: Tileset, secondary: Tileset): Uint16Array;
}

let active: ActiveTint | null = null;

/** 今の時間帯の色（昼なら null）。 */
export function activeTint(): ActiveTint | null {
  return active;
}

/** 時間帯の色を入れ替える（昼に戻すときは null）。 */
export function setActiveTint(tint: ActiveTint | null): void {
  active = tint;
}

/** 絵のキャッシュの鍵に入れる番号（昼は 0）。 */
export function tintGeneration(): number {
  return active?.generation ?? 0;
}
