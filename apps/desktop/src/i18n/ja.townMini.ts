import { hex } from "./ja";

/** タウンマップの小窓（#306）の文言（ZigzaguMap 独自）。 */
export const jaTownMini = {
  /** 表示メニューの項目と小窓の題名。 */
  menu: "タウンマップの小窓",
  title: "タウンマップ",
  /** 面（タウンマップNo の 1〜4）。 */
  pages: ["1: カントー", "2: 1〜3のしま", "3: 4〜5のしま", "4: 6〜7のしま"] as readonly string[],
  loading: "読み込んでいます…",
  failed: (message: string) => `タウンマップを読めません: ${message}`,
  /** 下の欄。 */
  hover: (region: number, name: string | null) => `${hex(region, 2)} ${name ?? ""}（押すと一覧を絞ります）`,
  current: (region: number, name: string | null) => `今のマップ: ${hex(region, 2)} ${name ?? ""}`,
  notPlaced: (region: number, name: string | null) => `今のマップの地名 ${hex(region, 2)} ${name ?? ""} はタウンマップに置かれていません`,
  none: "今のマップの地名はありません",
  /** ショートカット一覧（ヘルプ）。 */
  shortcutKeys: "マスの左クリック",
  shortcut: "その地名のマップだけにマップ一覧を絞る（場所:<番号>）",
  shortcutWhere: "タウンマップの小窓",
};
