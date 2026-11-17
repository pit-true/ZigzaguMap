import { ini } from "./ini";

const W = ini.Wetter;

/** 表示 > 天候を表示する（#498）の文言。名前の一部は Japanese.ini の天候の表から引く。 */
export const jaWeather = {
  menu: "天候を表示する",
  pickMenu: "プレビューする天候",
  mapWeather: "マップの天候",
  /** 天候の番号（0〜14）の名前。 */
  names: ["なし", "雲（水面に映る雲）", "晴れ", "雨", "雪", W["05"], "霧", W["07"], W["08"], "霧2（斜め）", "薄い霧（海底）", W["0B"], "日照り", W["0D"], "水中（泡）"],
  /** CFRU で 7 番が白い砂嵐に置き換わっているとき。 */
  whiteSandstorm: "白い砂嵐（7 番の置き換え）",
  started: (name: string) => `天候「${name}」を、仮の主人公と再生の画面に重ねています。`,
  waiting: (name: string) => `天候「${name}」を重ねます。表示 > 仮の主人公を置くで出る画面に重なります。`,
  stopped: "天候の表示をやめました。",
  cannot: (name: string, reason: string) => `この天候はプレビューできません（${name}: ${reason}）`,
  reasons: {
    drought: "FR 日本語バージョンではマップに入ると処理が終わらず止まり、色も変わりません",
    graphics: "ROM から天候の絵を読めません",
    rom: "この ROM の天候の表を読めません",
  },
} as const;
