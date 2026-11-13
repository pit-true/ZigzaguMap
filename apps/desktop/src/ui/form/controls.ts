/**
 * AdvanceMap（Delphi）のフォームを座標どおりに並べるための部品。
 * 位置と大きさは AdvanceMap の部品一覧（inventory）の値をそのまま渡す。
 * 自動操作から読み書きできるよう、操作できる部品には `data-auto-id` を付ける。
 */

/** 部品を親の中の決まった位置に置く。 */
export function place<T extends HTMLElement>(el: T, x: number, y: number, width?: number, height?: number): T {
  el.classList.add("am-abs");
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  if (width !== undefined) el.style.width = `${width}px`;
  if (height !== undefined) el.style.height = `${height}px`;
  return el;
}

/** 自動操作の ID を付ける。 */
export function autoId<T extends HTMLElement>(el: T, id: string): T {
  el.dataset["autoId"] = id;
  return el;
}

/** 座標で部品を並べる面（TScrollBox・タブの中身）。 */
export function panel(className: string, width: number, height: number): HTMLElement {
  const div = document.createElement("div");
  div.className = `am-panel ${className}`;
  div.style.width = `${width}px`;
  div.style.height = `${height}px`;
  return div;
}

/** 見出しつきの枠（TGroupBox）。子は枠の左上からの座標で置く。 */
export function group(title: string, x: number, y: number, width: number, height: number): HTMLElement {
  const box = place(document.createElement("div"), x, y, width, height);
  box.classList.add("am-group");
  const caption = document.createElement("span");
  caption.className = "am-group-title";
  caption.textContent = title;
  box.append(caption);
  return box;
}

/** ラベル（TLabel）。 */
export function label(text: string, x: number, y: number, width?: number): HTMLElement {
  const span = place(document.createElement("span"), x, y, width);
  span.classList.add("am-label");
  span.textContent = text;
  return span;
}

/** 1 行の入力欄（TEdit）。 */
export function edit(id: string, x: number, y: number, width: number, height = 19): HTMLInputElement {
  const input = autoId(place(document.createElement("input"), x, y, width, height), id);
  input.type = "text";
  input.spellcheck = false;
  input.classList.add("am-edit");
  return input;
}

/** 複数行の 16 進欄（TMemo。横スクロールだけ）。 */
export function memo(id: string, x: number, y: number, width: number, height: number): HTMLTextAreaElement {
  const area = autoId(place(document.createElement("textarea"), x, y, width, height), id);
  area.wrap = "off";
  area.spellcheck = false;
  area.classList.add("am-memo");
  return area;
}

/** ボタン（TButton）。 */
export function button(id: string, caption: string, x: number, y: number, width: number, height: number, onClick: () => void): HTMLButtonElement {
  const b = autoId(place(document.createElement("button"), x, y, width, height), id);
  b.type = "button";
  b.classList.add("am-button");
  b.textContent = caption;
  b.addEventListener("click", onClick);
  return b;
}

/** 選ぶだけのコンボ（TComboBox の csDropDownList）。 */
export function combo(id: string, options: readonly string[], x: number, y: number, width: number): HTMLSelectElement {
  const select = autoId(place(document.createElement("select"), x, y, width, 19), id);
  select.classList.add("am-combo");
  setOptions(select, options);
  return select;
}

/** コンボの選択肢を入れ替える。 */
export function setOptions(select: HTMLSelectElement, options: readonly string[]): void {
  const fragment = document.createDocumentFragment();
  for (const o of options) fragment.append(new Option(o));
  select.replaceChildren(fragment);
}

/** コンボの選択（範囲外なら空にする。AdvanceMap で一覧に無い値を選んだときと同じ）。 */
export function selectIndex(select: HTMLSelectElement, index: number): void {
  select.selectedIndex = index >= 0 && index < select.options.length ? index : -1;
}

/** チェックボックス（TCheckBox）。 */
export function check(id: string, caption: string, x: number, y: number, width: number): { root: HTMLElement; input: HTMLInputElement } {
  const root = place(document.createElement("label"), x, y, width, 17);
  root.classList.add("am-check");
  const input = autoId(document.createElement("input"), id);
  input.type = "checkbox";
  root.append(input, caption);
  return { root, input };
}

/** 上下ボタンつきの数値欄（TSpinEdit）。`onStep` は上下（+1 / -1）を押したとき。 */
export function spin(id: string, x: number, y: number, width: number, onStep: (delta: number) => void): { root: HTMLElement; input: HTMLInputElement } {
  const root = place(document.createElement("div"), x, y, width, 19);
  root.classList.add("am-spin");
  const input = autoId(document.createElement("input"), id);
  input.type = "text";
  input.spellcheck = false;
  const arrows = document.createElement("div");
  arrows.className = "am-spin-arrows";
  const up = autoId(document.createElement("button"), `${id}.up`);
  const down = autoId(document.createElement("button"), `${id}.down`);
  for (const [b, d] of [
    [up, 1],
    [down, -1],
  ] as const) {
    b.type = "button";
    b.tabIndex = -1;
    b.addEventListener("click", () => onStep(d));
    arrows.append(b);
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      onStep(e.key === "ArrowUp" ? 1 : -1);
    }
  });
  root.append(input, arrows);
  return { root, input };
}

/** 部品の有効・無効をまとめて切り替える。 */
export function setEnabled(enabled: boolean, ...els: (HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement)[]): void {
  for (const el of els) el.disabled = !enabled;
}
