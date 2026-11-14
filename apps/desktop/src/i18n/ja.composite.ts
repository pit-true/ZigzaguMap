import { ini } from "./ini";

/** 画像のコピー（Phase3 #246。ZigzaguMap 独自）。 */
export const jaComposite = {
  /** ツール > マップの画像をコピー（今のマップ 1 枚）。 */
  menuCopyMap: "マップの画像をコピー",
  /** ツール > 接続している全マップの画像をコピー。 */
  menuCopyWhole: "接続している全マップの画像をコピー",
  eventsNone: ini.EventType["05"],
  eventsPersons: "人だけ",
  eventsAll: "イベント全部",
  tooLargeTitle: "画像が大きすぎます",
  tooLarge: (w: number, h: number, max: number) =>
    `画像が ${w}×${h} 画素になり、辺が ${max} 画素を超えます。\n「はい」で 1/2、「いいえ」で 1/4 に縮めてコピーします。`,
  copied: (w: number, h: number, maps: number, scale: number) => `${maps} 枚のマップの画像（${w}×${h}${scale > 1 ? `、1/${scale}` : ""}）をクリップボードにコピーしました`,
  encodeFailed: "画像を PNG にできません",
} as const;
