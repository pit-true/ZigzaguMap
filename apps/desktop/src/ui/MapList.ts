import type { MapBankTable, MapId } from "@zigzagumap/core";
import { ja } from "../i18n/ja";

/** マップ一覧（バンクごとに折りたためる）。 */
export class MapList {
  readonly element: HTMLElement;
  private selected: HTMLElement | null = null;

  constructor(private readonly onSelect: (id: MapId) => void) {
    this.element = document.createElement("nav");
    this.element.className = "map-list";
    this.element.setAttribute("aria-label", ja.mapList);
    this.element.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-bank]");
      if (!target) return;
      this.highlight(target);
      this.onSelect({ bank: Number(target.dataset.bank), map: Number(target.dataset.map) });
    });
  }

  /** バンク表から一覧を作り直す。 */
  show(table: MapBankTable): void {
    const fragment = document.createDocumentFragment();
    for (let bank = 0; bank < table.bankCount; bank++) {
      const group = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = ja.bank(bank);
      group.append(summary);
      const list = document.createElement("ul");
      for (let map = 0; map < table.mapCount(bank); map++) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.bank = String(bank);
        button.dataset.map = String(map);
        button.textContent = ja.mapLabel(bank, map);
        item.append(button);
        list.append(item);
      }
      group.append(list);
      fragment.append(group);
    }
    this.selected = null;
    this.element.replaceChildren(fragment);
  }

  private highlight(target: HTMLElement): void {
    this.selected?.classList.remove("selected");
    target.classList.add("selected");
    this.selected = target;
  }
}
