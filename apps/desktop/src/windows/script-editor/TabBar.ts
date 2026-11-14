import { jaScriptEditor as t } from "../../i18n/ja.scriptEditor";
import type { EditorTab } from "./EditorTab";

/** タブの帯を押したときの処理。 */
export interface TabBarActions {
  /** タブを押した（切り替える）。 */
  select(tab: EditorTab): void;
  /** × か中ボタンで閉じる。 */
  close(tab: EditorTab): void;
}

/** 上のタブの帯（名前・未保存の印・× のボタン）。 */
export class TabBar {
  readonly element: HTMLElement;

  constructor(private readonly actions: TabBarActions) {
    this.element = document.createElement("div");
    this.element.className = "se-tabs";
    this.element.dataset["autoId"] = "se.tabs";
  }

  /** 描き直す。 */
  render(tabs: readonly EditorTab[], active: EditorTab | null): void {
    this.element.replaceChildren(...tabs.map((tab) => this.tabElement(tab, tab === active)));
  }

  private tabElement(tab: EditorTab, active: boolean): HTMLElement {
    const el = document.createElement("div");
    el.className = "se-tab";
    el.classList.toggle("active", active);
    el.classList.toggle("dirty", tab.dirty);
    el.classList.toggle("missing", tab.missing);
    el.title = tab.path;
    el.dataset["autoId"] = `se.tab:${tab.path}`;
    const name = document.createElement("span");
    name.className = "se-tab-name";
    name.textContent = tab.name;
    const mark = document.createElement("span");
    mark.className = "se-tab-dirty";
    mark.textContent = "●";
    mark.title = t.dirtyMark;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "se-tab-close";
    close.textContent = "×";
    close.title = t.closeTab;
    close.tabIndex = -1;
    close.dataset["autoId"] = `se.close:${tab.path}`;
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.close(tab);
    });
    el.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.actions.close(tab);
      }
    });
    el.addEventListener("click", () => this.actions.select(tab));
    el.append(name, mark, close);
    return el;
  }
}
