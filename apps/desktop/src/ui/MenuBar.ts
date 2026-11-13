import type { MenuItem } from "../app/menuDefinition";

/** メニューバーが使う、項目の状態と実行の窓口。 */
export interface MenuHost {
  /** 今の状態でのメニューの全項目。 */
  items(): MenuItem[];
  isEnabled(item: MenuItem): boolean;
  isChecked(id: string): boolean;
  run(id: string, label: string): void;
}

/** 開いているポップアップ 1 段分。 */
interface Popup {
  readonly element: HTMLElement;
  readonly items: readonly MenuItem[];
  readonly rows: HTMLElement[];
  active: number;
}

/**
 * Windows 風のメニューバー。Alt でフォーカス、矢印キーで移動、Enter・アクセスキーで実行、Esc で閉じる。
 * 項目は開くたびに MenuHost から作り直す（有効・チェックの状態を反映するため）。
 */
export class MenuBar {
  readonly element: HTMLElement;
  private readonly layer: HTMLElement;
  private tops: HTMLElement[] = [];
  private model: MenuItem[] = [];
  /** フォーカスしているトップの番号（-1 なら非アクティブ）。 */
  private topIndex = -1;
  /** 開いているポップアップ（0 がトップの下）。 */
  private popups: Popup[] = [];
  /** Alt だけを押して離したかを見る。 */
  private altAlone = false;

  constructor(private readonly host: MenuHost) {
    this.element = document.createElement("nav");
    this.element.className = "menu-bar";
    this.element.setAttribute("role", "menubar");
    this.layer = document.createElement("div");
    this.layer.className = "menu-layer";
    document.body.append(this.layer);

    this.element.addEventListener("mousedown", (e) => {
      const index = this.tops.indexOf((e.target as HTMLElement).closest(".menu-top") as HTMLElement);
      if (index < 0) return;
      e.preventDefault();
      if (this.popups.length > 0 && this.topIndex === index) this.close();
      else this.openTop(index, false);
    });
    this.element.addEventListener("mouseover", (e) => {
      const index = this.tops.indexOf((e.target as HTMLElement).closest(".menu-top") as HTMLElement);
      if (index >= 0 && this.popups.length > 0 && index !== this.topIndex) this.openTop(index, false);
    });
    document.addEventListener("mousedown", (e) => {
      if (this.topIndex < 0) return;
      const t = e.target as Node;
      if (!this.element.contains(t) && !this.layer.contains(t)) this.close();
    });
    window.addEventListener("blur", () => this.close());
    document.addEventListener("keydown", (e) => this.onKeyDown(e), true);
    document.addEventListener("keyup", (e) => this.onKeyUp(e), true);
    this.render();
  }

  /** メニューが操作中か（ほかのキー処理を止めるため）。 */
  get active(): boolean {
    return this.topIndex >= 0;
  }

  /** トップの項目を描き直す。 */
  render(): void {
    this.model = this.host.items();
    this.tops = this.model.map((item) => {
      const el = document.createElement("div");
      el.className = "menu-top";
      el.setAttribute("role", "menuitem");
      el.append(labelWithAccel(item));
      return el;
    });
    this.element.replaceChildren(...this.tops);
    this.highlightTop();
  }

  /** 閉じて非アクティブにする。 */
  close(): void {
    this.closePopupsFrom(0);
    this.topIndex = -1;
    this.highlightTop();
  }

  private openTop(index: number, selectFirst: boolean): void {
    this.closePopupsFrom(0);
    this.model = this.host.items();
    this.topIndex = index;
    this.highlightTop();
    const top = this.tops[index]!;
    const rect = top.getBoundingClientRect();
    this.openPopup(this.model[index]?.children ?? [], rect.left, rect.bottom, selectFirst);
  }

  private openPopup(items: readonly MenuItem[], x: number, y: number, selectFirst: boolean): void {
    const element = document.createElement("div");
    element.className = "menu-popup";
    element.setAttribute("role", "menu");
    const level = this.popups.length;
    const rows = items.map((item, i) => {
      const row = document.createElement("div");
      if (item.separator) {
        row.className = "menu-separator";
        return row;
      }
      const enabled = this.host.isEnabled(item);
      row.className = "menu-item" + (enabled ? "" : " disabled");
      row.setAttribute("role", "menuitem");
      const check = document.createElement("span");
      check.className = "menu-check";
      if (item.id && this.host.isChecked(item.id)) check.textContent = "✓";
      const label = document.createElement("span");
      label.className = "menu-label";
      label.append(labelWithAccel(item));
      const shortcut = document.createElement("span");
      shortcut.className = "menu-shortcut";
      shortcut.textContent = item.shortcut?.text ?? "";
      const arrow = document.createElement("span");
      arrow.className = "menu-arrow";
      if (item.children) arrow.textContent = "▶";
      row.append(check, label, shortcut, arrow);
      row.addEventListener("mouseenter", () => this.setActive(level, i, true));
      row.addEventListener("mouseup", (e) => {
        if (e.button === 0) this.activate(level, i);
      });
      return row;
    });
    element.append(...rows);
    this.layer.append(element);
    // 画面からはみ出さないよう位置を直す。
    const w = element.offsetWidth;
    const h = element.offsetHeight;
    element.style.left = `${Math.max(0, Math.min(x, window.innerWidth - w))}px`;
    element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - h))}px`;
    const popup: Popup = { element, items, rows, active: -1 };
    this.popups.push(popup);
    if (selectFirst) this.move(level, 1);
  }

  private closePopupsFrom(level: number): void {
    for (const p of this.popups.splice(level)) p.element.remove();
  }

  private setActive(level: number, index: number, openSub: boolean): void {
    const popup = this.popups[level];
    if (!popup) return;
    this.closePopupsFrom(level + 1);
    popup.active = index;
    popup.rows.forEach((r, i) => r.classList.toggle("active", i === index));
    const item = popup.items[index];
    if (openSub && item?.children && this.host.isEnabled(item)) this.openSubmenu(level, index, false);
  }

  private openSubmenu(level: number, index: number, selectFirst: boolean): void {
    const popup = this.popups[level]!;
    const row = popup.rows[index]!;
    const rect = row.getBoundingClientRect();
    this.closePopupsFrom(level + 1);
    this.openPopup(popup.items[index]!.children!, rect.right - 2, rect.top - 3, selectFirst);
  }

  /** 項目を実行する（サブメニューなら開く）。 */
  private activate(level: number, index: number): void {
    const item = this.popups[level]?.items[index];
    if (!item || item.separator || !this.host.isEnabled(item)) return;
    if (item.children) {
      this.openSubmenu(level, index, true);
      return;
    }
    this.close();
    if (item.id) this.host.run(item.id, item.label ?? item.id);
  }

  /** 区切り線を飛ばして上下に動く。 */
  private move(level: number, delta: number): void {
    const popup = this.popups[level];
    if (!popup || popup.items.length === 0) return;
    let i = popup.active;
    for (let n = 0; n < popup.items.length; n++) {
      i = (i + delta + popup.items.length) % popup.items.length;
      if (!popup.items[i]!.separator) break;
    }
    this.setActive(level, i, false);
  }

  private highlightTop(): void {
    this.tops.forEach((t, i) => {
      t.classList.toggle("active", i === this.topIndex);
      t.classList.toggle("open", i === this.topIndex && this.popups.length > 0);
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Alt") {
      this.altAlone = true;
      e.preventDefault();
      return;
    }
    this.altAlone = false;
    // Alt+アクセスキーでトップを開く。
    if (e.altKey && !e.ctrlKey && e.key.length === 1) {
      const index = this.model.findIndex((m) => m.accel?.toUpperCase() === e.key.toUpperCase());
      if (index >= 0) {
        e.preventDefault();
        e.stopPropagation();
        this.openTop(index, true);
        return;
      }
    }
    if (this.topIndex < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const level = this.popups.length - 1;
    switch (e.key) {
      case "Escape":
        if (level > 0) this.closePopupsFrom(level);
        else if (level === 0) {
          this.closePopupsFrom(0);
          this.highlightTop();
        } else this.close();
        return;
      case "ArrowLeft":
        if (level > 0) this.closePopupsFrom(level);
        else this.switchTop(-1);
        return;
      case "ArrowRight": {
        const popup = this.popups[level];
        const item = popup?.items[popup.active];
        if (popup && item?.children && this.host.isEnabled(item)) this.openSubmenu(level, popup.active, true);
        else this.switchTop(1);
        return;
      }
      case "ArrowDown":
        if (level < 0) this.openTop(this.topIndex, true);
        else this.move(level, 1);
        return;
      case "ArrowUp":
        if (level < 0) this.openTop(this.topIndex, true);
        else this.move(level, -1);
        return;
      case "Enter":
      case " ":
        if (level < 0) this.openTop(this.topIndex, true);
        else this.activate(level, this.popups[level]!.active);
        return;
      default:
        if (e.key.length === 1) this.pressAccel(level, e.key);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key !== "Alt") return;
    e.preventDefault();
    if (!this.altAlone) return;
    this.altAlone = false;
    if (this.topIndex >= 0) this.close();
    else {
      this.topIndex = 0;
      this.highlightTop();
    }
  }

  private switchTop(delta: number): void {
    const next = (this.topIndex + delta + this.tops.length) % this.tops.length;
    if (this.popups.length > 0) this.openTop(next, true);
    else {
      this.topIndex = next;
      this.highlightTop();
    }
  }

  private pressAccel(level: number, key: string): void {
    const upper = key.toUpperCase();
    if (level < 0) {
      const index = this.model.findIndex((m) => m.accel?.toUpperCase() === upper);
      if (index >= 0) this.openTop(index, true);
      return;
    }
    const popup = this.popups[level]!;
    const index = popup.items.findIndex((m) => m.accel?.toUpperCase() === upper);
    if (index >= 0) {
      this.setActive(level, index, false);
      this.activate(level, index);
    }
  }
}

/** 「ファイル(Z)」のように、アクセスキーに下線を付けた文字列。 */
function labelWithAccel(item: MenuItem): DocumentFragment {
  const f = document.createDocumentFragment();
  if (item.inlineAccel && item.label) {
    const u = document.createElement("u");
    u.textContent = item.label.slice(0, 1);
    f.append(u, item.label.slice(1));
    return f;
  }
  f.append(item.label ?? "");
  if (item.accel) {
    const u = document.createElement("u");
    u.textContent = item.accel;
    f.append("(", u, ")");
  }
  return f;
}
