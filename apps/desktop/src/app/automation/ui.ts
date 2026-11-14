import { AM_NAMES } from "./amNames";

/**
 * 自動操作の入口のうち、画面の部品を直接触る処理（`getField` / `setField` / `click` と部品の一覧）。メインと別ウィンドウで共通。
 *
 * 部品の指し方:
 * - アプリ独自の ID（`data-auto-id`。例 `event.person.x`）
 * - AdvanceMap の部品名（`field:Txt_PosX`。`am:` も可）。`data-am-name` で探す。`data-am-name` は、自動操作の入口が動いているときだけ
 *   `amNames.ts` の対応表から付ける（通常の起動では付けない）。ワールドマップエディターのように AdvanceMap の部品名を
 *   `data-auto-id` に使っている画面は、そのまま `data-auto-id` で見つかる。
 * 同じ名前が複数あるときは表示中のものを優先する。
 */

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLElement;

/** このウィンドウの対応表（ウィンドウのラベル → 対応表のキー）。 */
let windowKey = "main";

/** 対応表を選ぶ（別ウィンドウは自分のラベルを渡す）。 */
export function useAmNames(label: string): void {
  windowKey = label;
}

/** 対応表から `data-am-name` を付ける（付いていない部品だけ）。 */
export function stampAmNames(root: ParentNode = document): void {
  const table = AM_NAMES[windowKey];
  if (!table) return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-auto-id]")) {
    if (el.dataset["amName"]) continue;
    const name = table[el.dataset["autoId"]!];
    if (name) el.dataset["amName"] = name;
  }
}

/** `field:` / `am:` を外した AdvanceMap の部品名（付いていなければ null）。 */
function amNameOf(id: string): string | null {
  const m = /^(?:field|am):(.+)$/.exec(id);
  return m ? m[1]! : null;
}

function pick(all: HTMLElement[]): HTMLElement | undefined {
  return all.find((e) => isVisible(e)) ?? all[0];
}

/** ID（か AdvanceMap の部品名）の部品を探す。無ければ Error。 */
export function findField(id: string): Field {
  const am = amNameOf(id);
  if (am !== null) {
    stampAmNames();
    const el =
      pick([...document.querySelectorAll<HTMLElement>(`[data-am-name="${CSS.escape(am)}"]`)]) ??
      pick([...document.querySelectorAll<HTMLElement>(`[data-auto-id="${CSS.escape(am)}"]`)]);
    if (!el) throw new Error(`AdvanceMap の部品名 ${am} に当たる部品がありません`);
    return el;
  }
  const el = pick([...document.querySelectorAll<HTMLElement>(`[data-auto-id="${CSS.escape(id)}"]`)]);
  if (!el) throw new Error(`部品がありません: ${id}`);
  return el;
}

export function isVisible(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

/** 部品の状態（値、有効か、表示中か、コンボなら選択肢）。 */
export function getField(id: string): Record<string, unknown> {
  const el = findField(id);
  const out: Record<string, unknown> = {
    id,
    autoId: el.dataset["autoId"] ?? null,
    amName: el.dataset["amName"] ?? null,
    visible: isVisible(el),
    enabled: !(el as HTMLInputElement).disabled,
  };
  if (el instanceof HTMLSelectElement) {
    out["value"] = el.selectedIndex >= 0 ? el.options[el.selectedIndex]!.text : "";
    out["index"] = el.selectedIndex;
    out["options"] = el.options.length > 64 ? el.options.length : [...el.options].map((o) => o.text);
  } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    out["value"] = el.checked;
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    out["value"] = el.value;
    out["readOnly"] = el.readOnly;
    out["focused"] = document.activeElement === el;
  } else {
    out["value"] = el.textContent ?? "";
  }
  return out;
}

/**
 * 部品に値を入れて、人が入力したときと同じイベント（input → change）を送る。
 * コンボは番号（数値）か選択肢の文字列、チェックボックスは true / false。
 */
export function setField(id: string, value: unknown): Record<string, unknown> {
  const el = findField(id);
  if ((el as HTMLInputElement).disabled) throw new Error(`無効な部品です: ${id}`);
  if (el instanceof HTMLSelectElement) {
    const index = typeof value === "number" ? value : [...el.options].findIndex((o) => o.text === value);
    if (index < 0 || index >= el.options.length) throw new Error(`選択肢がありません: ${String(value)}`);
    el.selectedIndex = index;
  } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    el.checked = value === true;
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    throw new Error(`値を入れられない部品です: ${id}`);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) leave(el);
  return getField(id);
}

/** 部品を押す。 */
export function click(id: string): null {
  const el = findField(id);
  if ((el as HTMLButtonElement).disabled) throw new Error(`無効な部品です: ${id}`);
  el.click();
  return null;
}

/** 部品の一覧の 1 件（`ui.list` / `fields`）。 */
export function describeElement(el: HTMLElement): Record<string, unknown> {
  const base = {
    id: el.dataset["autoId"],
    amName: el.dataset["amName"] ?? null,
    tag: el.tagName.toLowerCase(),
    disabled: (el as HTMLInputElement).disabled === true,
    visible: isVisible(el),
  };
  if (el instanceof HTMLSelectElement) {
    return { ...base, index: el.selectedIndex, value: el.selectedIndex >= 0 ? el.options[el.selectedIndex]!.text : null, options: el.options.length };
  }
  if (el instanceof HTMLInputElement) {
    return el.type === "checkbox" || el.type === "radio" ? { ...base, checked: el.checked } : { ...base, value: el.value, readOnly: el.readOnly };
  }
  return { ...base, text: el.textContent };
}

/** 部品の一覧（`root` の中だけ。AdvanceMap の部品名も付ける）。 */
export function listFields(root: ParentNode = document): Record<string, unknown>[] {
  stampAmNames(root);
  return [...root.querySelectorAll<HTMLElement>("[data-auto-id]")].map(describeElement);
}

/**
 * 欄から離れる。ウィンドウがアクティブでない（自動操作で画面外に出している）と blur の出来事が来ないことがあるので、
 * そのときは同じ出来事を送る。
 */
export function leave(el: HTMLElement): void {
  let fired = false;
  const mark = (): void => {
    fired = true;
  };
  el.addEventListener("blur", mark, { once: true });
  el.blur();
  el.removeEventListener("blur", mark);
  if (!fired) {
    el.dispatchEvent(new FocusEvent("blur"));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }
}
