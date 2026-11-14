import "../styles/menu.css";

/** 右クリックのメニューの項目。 */
export interface ContextMenuItem {
  readonly label: string;
  /** 自動操作の ID（`contextMenu.press` の `id`）。 */
  readonly id: string;
  readonly enabled?: boolean;
  readonly run: () => void;
}

/** 開いている右クリックのメニュー（自動操作から読んで押す）。 */
export interface OpenContextMenu {
  readonly items: readonly ContextMenuItem[];
  readonly element: HTMLElement;
  close(): void;
}

let current: OpenContextMenu | null = null;

/** 開いている右クリックのメニュー（無ければ null）。 */
export function openContextMenu(): OpenContextMenu | null {
  return current;
}

/**
 * 右クリックのメニューを出す（メニューバーの下の一覧と同じ見た目）。外を押す・Esc・項目を選ぶと閉じる。
 * 一度に 1 つだけ開く。↑↓ で選び、Enter で実行する。
 */
export function showContextMenu(x: number, y: number, items: readonly ContextMenuItem[]): OpenContextMenu {
  current?.close();
  const element = document.createElement("div");
  element.className = "menu-popup context-menu";
  element.dataset["autoId"] = "contextMenu";
  element.tabIndex = -1;
  element.style.position = "fixed";
  let active = items.findIndex((i) => i.enabled !== false);
  const rows = items.map((item, i) => {
    const row = document.createElement("div");
    row.className = "menu-item" + (item.enabled === false ? " disabled" : "");
    row.dataset["autoId"] = `contextMenu.${item.id}`;
    const check = document.createElement("span");
    check.className = "menu-check";
    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = item.label;
    row.append(check, label);
    row.addEventListener("pointerenter", () => setActive(i));
    row.addEventListener("click", () => choose(i));
    return row;
  });
  element.append(...rows);
  const setActive = (i: number) => {
    active = i;
    rows.forEach((r, k) => r.classList.toggle("active", k === i));
  };
  const choose = (i: number) => {
    const item = items[i];
    if (!item || item.enabled === false) return;
    handle.close();
    item.run();
  };
  const outside = (e: PointerEvent) => {
    if (!element.contains(e.target as Node)) handle.close();
  };
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") handle.close();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      for (let k = 1; k <= items.length; k++) {
        const i = (active + step * k + items.length * 2) % items.length;
        if (items[i]!.enabled !== false) return setActive(i);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  };
  const handle: OpenContextMenu = {
    items,
    element,
    close() {
      element.remove();
      document.removeEventListener("pointerdown", outside, true);
      if (current === handle) current = null;
    },
  };
  element.addEventListener("keydown", keys);
  document.body.append(element);
  // 画面の外にはみ出さないように寄せる
  const r = element.getBoundingClientRect();
  element.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width - 2))}px`;
  element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height - 2))}px`;
  setActive(active);
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
  element.focus();
  current = handle;
  return handle;
}
