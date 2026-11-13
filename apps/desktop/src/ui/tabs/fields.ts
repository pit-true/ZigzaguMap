/** 読み取り専用の欄を作る小さな部品。 */

/** ラベルと値の表（値は読み取り専用の入力欄）。 */
export function fieldTable(rows: readonly (readonly [string, string])[]): HTMLElement {
  const table = document.createElement("div");
  table.className = "field-table";
  for (const [label, value] of rows) {
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.readOnly = true;
    input.value = value;
    table.append(name, input);
  }
  return table;
}

/** 選択肢のコンボボックス。 */
export function selectBox(options: readonly string[]): HTMLSelectElement {
  const select = document.createElement("select");
  for (const o of options) select.append(new Option(o));
  return select;
}

/** 見出しつきの枠（GroupBox）。 */
export function groupBox(title: string, ...children: Node[]): HTMLElement {
  const box = document.createElement("fieldset");
  box.className = "group-box";
  const legend = document.createElement("legend");
  legend.textContent = title;
  box.append(legend, ...children);
  return box;
}

/** 読み取り専用のコンボ（選ばれた 1 項目だけを出す）。 */
export function readOnlySelect(text: string): HTMLSelectElement {
  const select = selectBox([text]);
  select.disabled = true;
  select.className = "readonly-select";
  return select;
}
