/**
 * 自動操作の入口のうち、画面の部品を直接触る命令（`getField` / `setField` / `click`）。ダイアログは `dialog` 命令で読んで押す。
 * 部品は `data-auto-id` 属性の ID で指す（同じ ID が複数あるときは表示中のものを優先）。
 */

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLElement;

/** ID の部品を探す。無ければ Error。 */
export function findField(id: string): Field {
  const all = [...document.querySelectorAll<HTMLElement>(`[data-auto-id="${CSS.escape(id)}"]`)];
  const el = all.find((e) => isVisible(e)) ?? all[0];
  if (!el) throw new Error(`部品がありません: ${id}`);
  return el;
}

function isVisible(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

/** 部品の状態（値、有効か、表示中か、コンボなら選択肢）。 */
export function getField(id: string): Record<string, unknown> {
  const el = findField(id);
  const out: Record<string, unknown> = { id, visible: isVisible(el), enabled: !(el as HTMLInputElement).disabled };
  if (el instanceof HTMLSelectElement) {
    out["value"] = el.selectedIndex >= 0 ? el.options[el.selectedIndex]!.text : "";
    out["index"] = el.selectedIndex;
    out["options"] = el.options.length > 64 ? el.options.length : [...el.options].map((o) => o.text);
  } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
    out["value"] = el.checked;
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    out["value"] = el.value;
    out["readOnly"] = el.readOnly;
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
  } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
    el.checked = value === true;
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    throw new Error(`値を入れられない部品です: ${id}`);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();
  return getField(id);
}

/** 部品を押す。 */
export function click(id: string): null {
  const el = findField(id);
  if ((el as HTMLButtonElement).disabled) throw new Error(`無効な部品です: ${id}`);
  el.click();
  return null;
}
