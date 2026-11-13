import type { TabId } from "../app/EditorState";

/** タブの 1 枚。 */
export interface TabPage {
  readonly id: TabId;
  readonly title: string;
  readonly element: HTMLElement;
}

/** 中央のタブ（見出し 1 段）。中身は選ばれたページだけを表示する。 */
export class TabControl {
  readonly element: HTMLElement;
  private readonly heads = new Map<TabId, HTMLElement>();
  private readonly pages = new Map<TabId, HTMLElement>();

  constructor(pages: readonly TabPage[], onSelect: (id: TabId) => void) {
    this.element = document.createElement("section");
    this.element.className = "tabs";
    const strip = document.createElement("div");
    strip.className = "tab-strip";
    strip.setAttribute("role", "tablist");
    const body = document.createElement("div");
    body.className = "tab-body";
    for (const page of pages) {
      const head = document.createElement("div");
      head.className = "tab-head";
      head.setAttribute("role", "tab");
      head.textContent = page.title;
      head.addEventListener("mousedown", (e) => {
        if (e.button === 0) onSelect(page.id);
      });
      strip.append(head);
      this.heads.set(page.id, head);
      page.element.classList.add("tab-page");
      body.append(page.element);
      this.pages.set(page.id, page.element);
    }
    this.element.append(strip, body);
  }

  /** 選ばれたタブを表示する。 */
  show(id: TabId): void {
    for (const [key, head] of this.heads) head.classList.toggle("selected", key === id);
    for (const [key, page] of this.pages) page.hidden = key !== id;
  }
}
