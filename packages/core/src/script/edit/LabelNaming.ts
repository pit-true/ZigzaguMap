import { expandScriptLabelTemplate } from "../config/ScriptConfig.js";

/** ラベルを付けるイベントの種別（人・看板・スクリプトタイル・マップスクリプト）。 */
export type ScriptLabelKind = "person" | "sign" | "tile" | "map";

/** ラベル名に入れる種別の名前（eventscripts の種別に合わせる）。 */
export const SCRIPT_LABEL_KIND_NAMES: Readonly<Record<ScriptLabelKind, string>> = {
  person: "Npc",
  sign: "Sign",
  tile: "Tile",
  map: "MapScripts",
};

/** アセンブラ（GNU as）でラベルに使える名前か。 */
export function isScriptLabelName(name: string): boolean {
  return /^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(name);
}

/**
 * ラベルの頭に使うマップの名前。`.s` の名前から作る（`01_moegi.s` → `Moegi`、`pallet_town_demo_scripts.s` → `PalletTownDemo`）。
 * 数字だけの区切りと、末尾の `scripts` / `script` は外し、区切りごとに頭を大文字にしてつなぐ。
 * `.s` が無いか、名前に使える字が残らなければ、バンクとマップの番号（`Map3_0`）。
 */
export function scriptLabelMapName(scriptPath: string | null, bank: number, map: number): string {
  if (scriptPath) {
    const base = scriptPath.slice(scriptPath.lastIndexOf("/") + 1).replace(/\.s$/i, "");
    const words = base.split(/[^A-Za-z0-9]+/).filter((w) => w !== "" && !/^[0-9]+$/.test(w));
    while (words.length > 1 && /^scripts?$/i.test(words[words.length - 1]!)) words.pop();
    const name = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
    if (name !== "" && /^[A-Za-z]/.test(name) && !/^scripts?$/i.test(name)) return name;
  }
  return `Map${bank}_${map}`;
}

/**
 * 新しいイベントのラベル名。規則（`{map}_{kind}{index}`）を埋め、`taken` にある名前と重なれば番号を 1 つずつ増やす。
 * マップスクリプトは番号を付けない（重なったときだけ `2` から付ける）。
 */
export function newScriptLabel(
  template: string,
  values: { readonly map: string; readonly kind: ScriptLabelKind; readonly index: number },
  taken: (name: string) => boolean,
): string {
  const kind = SCRIPT_LABEL_KIND_NAMES[values.kind];
  if (values.kind === "map") {
    const base = expandScriptLabelTemplate(template, { map: values.map, kind, index: "" });
    if (!taken(base)) return base;
    for (let n = 2; ; n++) if (!taken(`${base}${n}`)) return `${base}${n}`;
  }
  for (let n = values.index; ; n++) {
    const name = expandScriptLabelTemplate(template, { map: values.map, kind, index: n });
    if (!taken(name)) return name;
  }
}

/** ラベルの文字列の名前（`gText_<ラベル>`。ND の漢字は後ろに `_k`）。 */
export function scriptTextLabel(label: string, kanji = false): string {
  return `gText_${label}${kanji ? "_k" : ""}`;
}
