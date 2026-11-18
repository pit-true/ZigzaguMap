import type { ScriptLabelPlace } from "@zigzagumap/core";

/** パスのファイルの名前。 */
const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** スクリプトのラベルの欄（イベントタブ・マップスクリプトのパネル）の文言（ZigzaguMap 独自）。 */
export const jaScriptLabel = {
  caption: "スクリプトのラベル",
  placeholder: "（ラベルなし）",
  showAll: "ラベルを全部出す（マップの .s のあとに、ほかの .s の .global のラベル）",
  invalid: (label: string) => `ラベルに使えない名前です: ${label}（半角の英字・数字・_ . $ で、数字で始めない）`,
  missing: (label: string) => `${label} はマップの .s にも、ほかの .s の .global にも見つかりません（ビルドで Symbol missing になります）`,
  elsewhere: (label: string, path: string) => `${label} は別のファイル（${base(path)}）にあります`,
  notGlobal: (label: string, path: string) =>
    `${label} は別のファイル（${base(path)}）にありますが、.global でないので、ほかのファイルからは見えません（ビルドで Symbol missing になります）`,
  /** ラベルの場所（#554）に合わせた、欄のヒント。 */
  place: (label: string, place: ScriptLabelPlace): string => {
    switch (place.kind) {
      case "map":
        return label;
      case "global":
        return jaScriptLabel.elsewhere(label, place.path);
      case "notGlobal":
        return jaScriptLabel.notGlobal(label, place.path);
      case "missing":
        return jaScriptLabel.missing(label);
    }
  },
};
