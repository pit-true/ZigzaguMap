import { jaMapFind as t } from "../i18n/ja.mapFind";
import "../styles/mapFind.css";
import type { MapTree } from "./MapTree";

/** マップ一覧の上の絞り込みの欄（#237）。入力するたびに一覧を絞り込む。Esc か × で消す。 */
export class MapTreeFilter {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;

  constructor(tree: MapTree) {
    this.element = document.createElement("div");
    this.element.className = "map-tree-filter";
    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.placeholder = t.filterPlaceholder;
    this.input.spellcheck = false;
    this.input.dataset["autoId"] = "tree.filter";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "×";
    clear.title = t.filterClear;
    clear.dataset["autoId"] = "tree.filterClear";
    const apply = (): void => tree.setFilter(this.input.value);
    this.input.addEventListener("input", apply);
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.input.value = "";
        apply();
      } else if (e.key === "ArrowDown" || e.key === "Enter") {
        // 一覧へ移って、↑↓と Enter で選べるようにする
        e.preventDefault();
        tree.element.focus();
      }
    });
    clear.addEventListener("click", () => {
      this.input.value = "";
      apply();
    });
    this.element.append(this.input, clear);
  }
}
