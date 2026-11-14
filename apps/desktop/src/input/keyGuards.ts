import { openDialogs } from "../ui/Dialog";

/** 後ろを覆うダイアログが開いているか（Grosser Block のような覆わない窓は数えない）。 */
export function modalOpen(): boolean {
  return openDialogs.some((d) => d.element.parentElement?.classList.contains("dialog-overlay") === true);
}

/** 文字を入れる欄の中か（チェックボックスなどは入力欄に数えない）。 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button"].includes(el.type);
  return el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}
