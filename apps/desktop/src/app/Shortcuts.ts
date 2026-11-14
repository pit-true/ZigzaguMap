import { buildMenu, flattenMenu, type MenuItem } from "./menuDefinition";
import { openDialogs } from "../ui/Dialog";
import type { App } from "./App";

/**
 * キーボードのショートカット。メニューにあるもの（Ctrl+O、F5、Ctrl+S など）と、
 * アンドゥ（Ctrl+Z）・リドゥ（Ctrl+Y、Ctrl+Shift+Z）を受け付ける。入力欄の中では反応しない。
 */
export function installShortcuts(app: App): void {
  const items = flattenMenu(buildMenu([])).filter((i): i is MenuItem & { id: string } => !!i.shortcut && !!i.id);
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || isTyping(e.target)) return;
    const key = e.key.toUpperCase();
    if (e.ctrlKey && !e.altKey && (key === "Z" || key === "Y")) {
      e.preventDefault();
      if (key === "Z" && !e.shiftKey) app.undo();
      else app.redo();
      return;
    }
    // Delete: イベントタブで選んでいるイベントを削除する（#220。確認のダイアログを出す）
    if (key === "DELETE" && !e.ctrlKey && !e.altKey && !e.shiftKey && app.state.tab === "event" && openDialogs.length === 0) {
      e.preventDefault();
      app.deleteSelectedEvent();
      return;
    }
    const item = items.find(
      (i) => i.shortcut!.key === key && !!i.shortcut!.ctrl === e.ctrlKey && !!i.shortcut!.alt === e.altKey && !!i.shortcut!.shift === e.shiftKey,
    );
    if (!item) return;
    e.preventDefault();
    if (app.actions.isEnabled(item)) app.actions.run(item.id, item.label);
  });
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
