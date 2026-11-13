/**
 * AdvanceMap のフォームと同じ座標に部品を置くための小さな関数群。
 * 部品には `data-auto-id`（AdvanceMap の部品名）を付け、自動操作の getField / setField / click から指せるようにする。
 */

/** 位置と大きさ（親からの px）。 */
export type Rect = readonly [x: number, y: number, width?: number, height?: number];

function place<T extends HTMLElement>(el: T, parent: HTMLElement, [x, y, w, h]: Rect, autoId?: string): T {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  if (w !== undefined) el.style.width = `${w}px`;
  if (h !== undefined) el.style.height = `${h}px`;
  if (autoId) el.dataset["autoId"] = autoId;
  parent.append(el);
  return el;
}

/** 部品を入れる箱（グループボックスの中身や、スクロールボックス）。 */
export function box(parent: HTMLElement, rect: Rect, className = "wm-box"): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return place(el, parent, rect);
}

/** 見出しつきの枠（TGroupBox）。 */
export function groupBox(parent: HTMLElement, rect: Rect, caption: string): HTMLDivElement {
  const el = box(parent, rect, "wm-group");
  const legend = document.createElement("span");
  legend.className = "wm-legend";
  legend.textContent = caption;
  el.append(legend);
  return el;
}

/** ラベル（TLabel）。 */
export function label(parent: HTMLElement, rect: Rect, text: string, autoId?: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "wm-label";
  el.textContent = text;
  return place(el, parent, rect, autoId);
}

/** 1 行の入力欄（TEdit）。 */
export function edit(parent: HTMLElement, rect: Rect, autoId: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.className = "wm-edit";
  el.spellcheck = false;
  return place(el, parent, rect, autoId);
}

/** ボタン（TButton）。 */
export function button(parent: HTMLElement, rect: Rect, text: string, autoId: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "wm-button";
  el.textContent = text;
  el.addEventListener("click", onClick);
  return place(el, parent, rect, autoId);
}

/** チェックボックス（TCheckBox）。 */
export function checkBox(parent: HTMLElement, rect: Rect, text: string, autoId: string, checked: boolean, onChange: () => void): HTMLInputElement {
  const wrap = document.createElement("label");
  wrap.className = "wm-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.dataset["autoId"] = autoId;
  input.addEventListener("change", onChange);
  wrap.append(input, document.createTextNode(text));
  place(wrap, parent, rect);
  return input;
}

/** 選ぶだけのコンボボックス（TComboBox、csDropDownList）。 */
export function comboBox(parent: HTMLElement, rect: Rect, autoId: string, items: readonly string[], onChange: () => void): HTMLSelectElement {
  const el = document.createElement("select");
  el.className = "wm-combo";
  for (const [i, text] of items.entries()) el.add(new Option(text, String(i)));
  el.addEventListener("change", onChange);
  return place(el, parent, rect, autoId);
}
