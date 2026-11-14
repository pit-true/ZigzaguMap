import { ini } from "./ini";

/** 表示メニューの文言（ZigzaguMap 独自。AdvanceMap の文言があるものは ini から引く）。 */
export const jaView = {
  /** 移動エリアの透明度の小窓の題名。 */
  opacityTitle: ini.Menue["1217"],
  /** スライダーの左端（0%）。 */
  opacityLeft: "色だけ",
  /** スライダーの右端（100%）。 */
  opacityRight: "マップだけ",
  close: "閉じる",
} as const;
