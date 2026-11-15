import { hex } from "./ja";

/** 地名の番号と名前（「58 マサラタウン」）。 */
const place = (region: number, name: string | null) => `${hex(region, 2)} ${name ?? ""}`.trimEnd();

/** タウンマップの小窓（#306・#386）の文言（ZigzaguMap 独自）。 */
export const jaTownMini = {
  /** 表示メニューの項目と小窓の題名。 */
  menu: "タウンマップの小窓",
  title: "タウンマップ",
  /** 面（タウンマップNo の 1〜4）。 */
  pages: ["1: カントー", "2: 1〜3のしま", "3: 4〜5のしま", "4: 6〜7のしま"] as readonly string[],
  loading: "読み込んでいます…",
  failed: (message: string) => `タウンマップを読めません: ${message}`,
  /** 下の欄。 */
  hover: (region: number, name: string | null) => `${place(region, name)}（押すと一覧を絞ります）`,
  current: (region: number | null, name: string | null, source: string) =>
    region === null ? `今のマップ${source}` : `今のマップ: ${place(region, name)}${source}`,
  /** 枠をどこから出したか（下の欄の後ろに付ける）。 */
  sourceMap: "（自分で紐づけ・このマップだけ）",
  sourceSection: "（自分で紐づけ）",
  sourceRom: "（ROM のデータ）",
  none: "マップを開いていません",
  /** ROM のデータにも紐づけにも無いとき。 */
  noLink: (region: number | null, name: string | null) =>
    `紐づけがありません（${region === null ? "地名なし" : `地名 ${place(region, name)}`}）。小窓を右クリックして「ここに紐づける」を選んでください`,
  /** 右クリックのメニュー。 */
  linkSection: (region: number, name: string | null) => `今の地名（${place(region, name)}）をここに紐づける`,
  linkSectionNone: "今の地名をここに紐づける（今のマップに地名がありません）",
  linkMap: "今のマップだけをここに紐づける",
  unlinkMap: "紐づけを外す（このマップだけ）",
  unlinkSection: (region: number, name: string | null) => `紐づけを外す（地名 ${place(region, name)}）`,
  /** ステータスバー。 */
  linked: (what: string, page: number, x: number, y: number, width: number, height: number) =>
    `${what}を面 ${page + 1} の (${x}, ${y}) から ${width}×${height} マスに紐づけました（ZigzaguMap の画面だけで使います）`,
  unlinked: (what: string) => `${what}の紐づけを外しました`,
  whatSection: (region: number, name: string | null) => `地名 ${place(region, name)}`,
  whatMap: (bank: number, map: number) => `マップ ${bank}.${map}`,
  saveFailed: (message: string) => `タウンマップの紐づけを保存できません: ${message}`,
  /** ショートカット一覧（ヘルプ）。 */
  shortcutKeys: "マスの左クリック",
  shortcut: "その地名のマップだけにマップ一覧を絞る（場所:<番号>）",
  shortcutMenuKeys: "右クリック",
  shortcutMenu: "そのマスに今の地名・今のマップを紐づける、紐づけを外す（ZigzaguMap の画面だけで使う位置）",
  shortcutDragKeys: "右ドラッグ",
  shortcutDrag: "範囲（複数のマス）を選び、離すと紐づけのメニューを出す",
  shortcutWhere: "タウンマップの小窓",
};
