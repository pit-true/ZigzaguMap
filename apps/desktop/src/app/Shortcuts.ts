import { buildMenu, flattenMenu, type MenuItem } from "./menuDefinition";
import { openDialogs } from "../ui/Dialog";
import { KEY_ACTIONS, SCRIPT_KEY_SLOTS, matchesKey } from "./keymap";
import type { App } from "./App";

/**
 * キーボードのショートカット。メニューにあるもの（Ctrl+O、F5、Ctrl+S など）と、
 * アンドゥ（Ctrl+Z）・リドゥ（Ctrl+Y、Ctrl+Shift+Z）、イベントの削除（Delete）と複製（Ctrl+D）を受け付ける。入力欄の中では反応しない。
 * キーは `app/keymap.ts` の表から引く（設定 > ショートカットの変更… で変えたものも、すぐ使える。#392）。
 */
export function installShortcuts(app: App): void {
  const items = new Map(
    flattenMenu(buildMenu([]))
      .filter((i): i is MenuItem & { id: string } => !!i.id)
      .map((i) => [i.id, i] as const),
  );
  const menuIds = KEY_ACTIONS.filter((a) => a.menu).map((a) => a.id);
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || isTyping(e.target)) return;
    if (matchesKey("edit.undo", e) || matchesKey("edit.redo", e)) {
      e.preventDefault();
      if (matchesKey("edit.undo", e)) app.undo();
      else app.redo();
      return;
    }
    // Delete: イベントタブで選んでいるイベントを削除する（#220。確認のダイアログを出す）
    if (matchesKey("event.delete", e) && app.state.tab === "event" && openDialogs.length === 0) {
      e.preventDefault();
      app.deleteSelectedEvent();
      return;
    }
    // Ctrl+D: イベントタブで選んでいるイベントを複製する（Phase5 #399）
    if (matchesKey("event.duplicate", e) && app.state.tab === "event" && openDialogs.length === 0) {
      e.preventDefault();
      app.duplicateSelectedEvents();
      return;
    }
    // Ctrl+C・X・V: イベントタブのコピー・切り取り・貼り付け（Phase7 #519）
    for (const action of ["copy", "cut", "paste"] as const) {
      if (matchesKey(`event.${action}`, e) && app.state.tab === "event" && openDialogs.length === 0) {
        e.preventDefault();
        app.eventClipboard(action);
        return;
      }
    }
    // スクリプトの操作（Phase5 #405。ツール > スクリプト の N 番目）
    for (let n = 1; n <= SCRIPT_KEY_SLOTS; n++) {
      if (matchesKey(`scripts.run.${n}`, e) && openDialogs.length === 0) {
        e.preventDefault();
        app.actions.run(`scripts.run.${n}`);
        return;
      }
    }
    const id = menuIds.find((m) => matchesKey(m, e));
    const item = id ? items.get(id) : undefined;
    if (!item) return;
    e.preventDefault();
    if (app.actions.isEnabled(item)) app.actions.run(item.id, item.label);
  });
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}
