import { hex } from "./ja";

/** ブロックの使用回数・移動許可の自動選択・使用の印（#235）の文言（ZigzaguMap 独自）。 */
export const jaBlockUsage = {
  autoMovement: "移動許可を自動で選ぶ",
  autoMovementHint: "ブロックを 1 つ選ぶと、全マップでそのブロックにいちばん多い移動許可を選ぶ（移動エリアタブで描く値）",
  counting: "使用回数: 数えています…",
  count: (all: number, here: number) => `使用回数: ${all}（このマップ ${here}）`,
  most: (value: number, name: string) => `多い移動許可: ${hex(value, 2)}（${name}）`,
  mostNone: "多い移動許可: なし（使われていない）",
  multiple: "使用回数: ブロックを 1 つ選ぶと出します",
  autoSelected: (block: number, value: number, name: string) => `ブロック ${hex(block, 4)} の移動許可を ${hex(value, 2)}（${name}）にしました`,
  /** 表示 > 移動許可の強調。 */
  menuMarks: "移動許可の強調",
} as const;
