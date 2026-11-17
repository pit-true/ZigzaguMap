import { hex } from "./ja";

/** ミニマップの小窓の文言（Phase7 #511。ZigzaguMap 独自）。 */
export const jaMinimap = {
  /** 表示メニューの項目と小窓の題名。 */
  menu: "ミニマップ",
  title: "ミニマップ",
  /** マップを出すタブでないとき。 */
  noMap: "マップ・移動エリア・イベントのタブで出ます",
  /** タウンマップの現在地のまわりの拡大を出すチェック。 */
  town: "タウンマップも出す",
  /** 地名がタウンマップに無く、紐づけも無いとき。 */
  townNone: "タウンマップに場所がありません",
  /** 拡大の下の欄（地名と、自分で紐づけた位置か）。 */
  townPlace: (region: number | null, name: string | null, linked: boolean) =>
    `${region === null ? "地名なし" : `${hex(region, 2)} ${name ?? ""}`.trimEnd()}${linked ? "（自分で紐づけ）" : ""}`,
} as const;
