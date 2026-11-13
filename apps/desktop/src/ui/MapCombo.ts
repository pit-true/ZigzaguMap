import type { MapId } from "@zigzagumap/core";
import type { TreeNode } from "../app/MapTreeModel";

/** コンボボックス表示が使う窓口。 */
export interface MapComboHost {
  openMap(id: MapId): void;
}

/**
 * 設定 > コンボボックス のときに、左の一覧の代わりにツールバーの下へ出す 2 つのコンボ
 * （AdvanceMap の Cbo_Main と Cbo_Map。マップ名のグループと、その中のマップ）。マップを選ぶと開く。
 */
export class MapCombo {
  readonly element: HTMLElement;
  private readonly main: HTMLSelectElement;
  private readonly map: HTMLSelectElement;
  private groups: readonly TreeNode[] = [];

  constructor(private readonly host: MapComboHost) {
    this.element = document.createElement("div");
    this.element.className = "map-combo";
    this.element.hidden = true;
    this.main = document.createElement("select");
    this.map = document.createElement("select");
    this.element.append(this.main, this.map);
    this.main.addEventListener("change", () => this.fillMaps());
    this.map.addEventListener("change", () => {
      const node = this.currentGroup()?.children?.[this.map.selectedIndex - 1];
      if (node?.mapId) host.openMap(node.mapId);
    });
  }

  /** グループを入れ直す（null で空）。 */
  show(groups: readonly TreeNode[] | null): void {
    this.groups = groups ?? [];
    this.main.replaceChildren(new Option(""), ...this.groups.map((g) => new Option(g.label)));
    this.map.replaceChildren();
  }

  /** 開いたマップに選択を合わせる。 */
  setOpened(id: MapId | null): void {
    if (!id) return;
    const gi = this.groups.findIndex((g) => g.children?.some((c) => same(c.mapId, id)));
    if (gi < 0) return;
    if (this.main.selectedIndex !== gi + 1) {
      this.main.selectedIndex = gi + 1;
      this.fillMaps();
    }
    const mi = this.groups[gi]!.children!.findIndex((c) => same(c.mapId, id));
    this.map.selectedIndex = mi + 1;
  }

  /** 表示・非表示。 */
  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  private currentGroup(): TreeNode | undefined {
    return this.groups[this.main.selectedIndex - 1];
  }

  private fillMaps(): void {
    const g = this.currentGroup();
    this.map.replaceChildren(new Option(""), ...(g?.children ?? []).map((c) => new Option(c.label)));
  }
}

function same(a: MapId | undefined, b: MapId): boolean {
  return !!a && a.bank === b.bank && a.map === b.map;
}
