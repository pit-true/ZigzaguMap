import type { EnableWhen } from "../app/menuDefinition";
import { ja } from "../i18n/ja";
import { ICONS } from "./icons";

/** ツールバーのボタン。`id` はメニューと同じアクションの ID。 */
interface ToolButton {
  readonly icon: string;
  readonly id: string;
  readonly hint: string;
  readonly enable: EnableWhen;
}

/** ツールバーが使う窓口。 */
export interface ToolbarHost {
  isEnabled(when: EnableWhen): boolean;
  isChecked(id: string): boolean;
  run(id: string): void;
  /** 並べ替えを変える。 */
  setSort(mode: number): void;
  sortMode(): number;
}

/** AdvanceMap と同じ並び（区切りは null、並べ替えのコンボは "sort"）。 */
const LAYOUT: readonly (ToolButton | null | "sort")[] = [
  { icon: "open", id: "file.open", hint: ja.toolbar.open, enable: "always" },
  { icon: "save", id: "file.export", hint: ja.toolbar.save, enable: "map" },
  null,
  { icon: "newMap", id: "map.new", hint: ja.toolbar.newMap, enable: "rom" },
  { icon: "insertMap", id: "map.insert", hint: ja.toolbar.insertMap, enable: "map" },
  null,
  { icon: "previousMap", id: "tools.previousMap", hint: ja.toolbar.previousMap, enable: "map" },
  { icon: "showObjects", id: "view.objects", hint: ja.toolbar.showObjects, enable: "map" },
  "sort",
  null,
  { icon: "blockEditor", id: "tools.blockEditor", hint: ja.toolbar.blockEditor, enable: "map" },
  { icon: "connections", id: "tools.connections", hint: ja.toolbar.connections, enable: "map" },
  { icon: "worldMap", id: "tools.worldMap", hint: ja.toolbar.worldMap, enable: "rom" },
  null,
  { icon: "find", id: "tools.find", hint: ja.toolbar.find, enable: "rom" },
  null,
  { icon: "about", id: "help.about", hint: ja.toolbar.about, enable: "always" },
];

/** 上部のツールバー（32×32 のアイコン、ホバーと押下の枠、並べ替えのコンボ）。 */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly buttons: { def: ToolButton; el: HTMLElement }[] = [];
  private readonly sort: HTMLSelectElement;

  constructor(private readonly host: ToolbarHost) {
    this.element = document.createElement("header");
    this.element.className = "toolbar";
    this.sort = document.createElement("select");
    this.sort.className = "toolbar-sort";
    for (const label of ja.sortModes) this.sort.append(new Option(label));
    this.sort.addEventListener("change", () => host.setSort(this.sort.selectedIndex));

    for (const entry of LAYOUT) {
      if (entry === null) {
        const sep = document.createElement("div");
        sep.className = "toolbar-separator";
        this.element.append(sep);
      } else if (entry === "sort") {
        this.element.append(this.sort);
      } else {
        const el = document.createElement("div");
        el.className = "toolbar-button";
        el.title = entry.hint;
        el.innerHTML = ICONS[entry.icon] ?? "";
        el.addEventListener("click", () => {
          if (host.isEnabled(entry.enable)) host.run(entry.id);
        });
        this.buttons.push({ def: entry, el });
        this.element.append(el);
      }
    }
    this.update();
  }

  /** 有効・押下状態と並べ替えの選択を反映する（AdvanceMap と同じく、無効でも見た目は変えない）。 */
  update(): void {
    for (const { def, el } of this.buttons) {
      el.classList.toggle("disabled", !this.host.isEnabled(def.enable));
      el.classList.toggle("checked", this.host.isChecked(def.id));
    }
    this.sort.disabled = !this.host.isEnabled("rom");
    this.sort.selectedIndex = this.host.sortMode();
  }

  /** 表示・非表示。 */
  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }
}
