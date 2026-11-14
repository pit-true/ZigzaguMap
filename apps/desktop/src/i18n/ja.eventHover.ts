import type { SummaryEntry } from "@zigzagumap/core";

/** イベントのホバーの吹き出し（#226・#240）の文言（ZigzaguMap 独自）。 */
export const jaEventHover = {
  /** 見出し（`人 3` など。種類の名前はイベントタブと同じ）。 */
  title: (kindName: string, index: number) => `${kindName} ${index}`,
  label: (label: string) => `ラベル: ${label}`,
  loading: "読み込み中…",
  noScript: "スクリプトなし",
  missingLabel: (label: string) => `ラベル ${label} が .s に見つかりません`,
  romFallback: "ROM のスクリプトを出します",
  empty: "セリフ・アイテムなどは見つかりませんでした",
  more: "…（ほかにもあります）",
  failed: (message: string) => `要約できませんでした: ${message}`,
  clone: (bank: number, map: number, id: number) => `クローン（${bank}.${map} の人 ${id}）`,
  trainerPerson: (range: number) => `トレーナー（視界 ${range}）`,
  hiddenItem: (name: string, amount: number) => `隠しアイテム: ${name}${amount > 1 ? ` ×${amount}` : ""}`,
  trapCondition: (variable: number, value: number) => `変数 0x${variable.toString(16).toUpperCase().padStart(4, "0")} が ${value} のとき`,
  warp: (bank: number, map: number, name: string | null, warpId: number) => `行き先: ${bank}.${map}${name ? ` ${name}` : ""} のワープ ${warpId}`,
  entry: (e: SummaryEntry): string => {
    switch (e.type) {
      case "text":
        return `「${e.text}」`;
      case "trainer":
        return `トレーナー ${e.id !== null ? `0x${e.id.toString(16).toUpperCase()}` : (e.symbol ?? "?")}${e.intro ? `「${e.intro}」` : ""}`;
      case "mart":
        return `ショップ: ${e.items.join("、")}${e.more > 0 ? ` ほか ${e.more} 品` : ""}`;
      case "item":
        return `アイテム: ${e.item}${e.amount !== null && e.amount > 1 ? ` ×${e.amount}` : ""}`;
      case "pokemon":
        return `ポケモン: ${e.species}${e.level !== null ? ` Lv.${e.level}` : ""}`;
      case "wild":
        return `野生戦: ${e.species}${e.level !== null ? ` Lv.${e.level}` : ""}`;
    }
  },
};
