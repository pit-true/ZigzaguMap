import { jaMapFind as t } from "../i18n/ja.mapFind";
import "../styles/mapFind.css";
import type { MapId } from "@zigzagumap/core";
import type { MapCatalog } from "../app/MapCatalog";
import { hasSpecialTerms, matchesSpecialTerms, parseMapTreeQuery } from "../app/mapTreeQuery";
import { jaSeams } from "../i18n/ja.seams";
import type { MapTree } from "./MapTree";

/**
 * マップ一覧の上の絞り込みの欄（#237）。入力するたびに一覧を絞り込む。Esc か × で消す。
 * 「場所:58,7E」（地名の番号）と「地形:9」（配置の番号）も書ける（#305。`app/mapTreeQuery.ts`）。
 */
export class MapTreeFilter {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly apply: () => void;

  constructor(tree: MapTree, catalog: () => MapCatalog | null = () => null) {
    this.element = document.createElement("div");
    this.element.className = "map-tree-filter";
    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.placeholder = t.filterPlaceholder;
    this.input.spellcheck = false;
    this.input.dataset["autoId"] = "tree.filter";
    this.input.title = jaSeams.filterHint;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "×";
    clear.title = t.filterClear;
    clear.dataset["autoId"] = "tree.filterClear";
    const apply = (): void => {
      const raw = this.input.value;
      const q = parseMapTreeQuery(raw);
      const match = hasSpecialTerms(q)
        ? (id: MapId): boolean => {
            const info = catalog()?.get(id);
            return !!info && matchesSpecialTerms(info, q);
          }
        : null;
      tree.setFilter(q.text, match, raw);
    };
    this.apply = apply;
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

  /** 欄に入れて絞り込む（タウンマップの小窓から「場所:58」で絞るときなど。#306）。 */
  setText(text: string): void {
    this.input.value = text;
    this.apply();
  }
}
