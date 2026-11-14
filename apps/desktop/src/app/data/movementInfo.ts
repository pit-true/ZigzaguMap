import { jaMovementInfo as t } from "../../i18n/ja.movementInfo";

/** 高さの特別な値。 */
const HEIGHT_TRANSITION = 0;
const HEIGHT_WATER = 1;
const HEIGHT_BRIDGE = 15;

/**
 * 移動許可（00〜3F）の説明（#308）。値は「高さ × 4 + 通行」（マスの 16 ビットのビット 10〜15）。
 * 通行 0 は通れる、1 は通れない。2・3 はゲームでは通れない（奇数を使うよう注意を足す）。
 * 高さ 0 は高さの切り替え、1 は水面、15 は橋。
 */
export function movementInfo(value: number): string {
  const collision = value & 3;
  const height = (value >> 2) & 15;
  if (collision >= 2) return `${describe(height, true)}。${t.oddOnly(collision)}`;
  return describe(height, collision === 1);
}

function describe(height: number, blocked: boolean): string {
  switch (height) {
    case HEIGHT_TRANSITION:
      return blocked ? t.transitionBlocked : t.transition;
    case HEIGHT_WATER:
      return blocked ? t.waterBlocked : t.water;
    case HEIGHT_BRIDGE:
      return blocked ? t.bridgeBlocked : t.bridge;
    default:
      return blocked ? t.blocked(height) : t.passable(height);
  }
}
