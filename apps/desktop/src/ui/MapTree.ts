import type { MapId } from "@zigzagumap/core";
import type { TreeNode } from "../app/MapTreeModel";
import { HEADER_ROOT_KEY } from "../app/MapTreeModel";
import { ja } from "../i18n/ja";

/** マップ一覧が使う窓口。 */
export interface MapTreeHost {
  /** マップを開く（ダブルクリックか Enter）。 */
  openMap(id: MapId): void;
  /** 未出力か。 */
  isDirty(id: MapId): boolean;
}

/** 描いた行。 */
interface Row {
  readonly node: TreeNode;
  readonly element: HTMLElement;
  readonly depth: number;
  childBox: HTMLElement | null;
}

/**
 * 左のマップ一覧（AdvanceMap と同じ操作: 選ぶだけでは開かず、ダブルクリックか Enter で開く。
 * グループはダブルクリック・Enter・左右キーで開閉）。子の行は初めて開いたときに作る。
 */
export class MapTree {
  readonly element: HTMLElement;
  private readonly rows = new Map<string, Row>();
  private readonly expanded = new Set<string>();
  private roots: readonly TreeNode[] = [];
  private selectedKey: string | null = null;
  private openedId: MapId | null = null;

  constructor(private readonly host: MapTreeHost) {
    this.element = document.createElement("div");
    this.element.className = "map-tree";
    this.element.tabIndex = 0;
    this.element.setAttribute("role", "tree");
    this.element.addEventListener("mousedown", (e) => {
      const row = this.rowOf(e.target);
      if (row) this.select(row.node.key);
    });
    this.element.addEventListener("dblclick", (e) => {
      const row = this.rowOf(e.target);
      if (row) this.activate(row);
    });
    this.element.addEventListener("keydown", (e) => this.onKey(e));
  }

  /** 一覧を作り直す（展開状態はできるだけ残す）。 */
  show(roots: readonly TreeNode[]): void {
    this.roots = roots;
    this.rows.clear();
    // 根が 1 つだけ（マップの表示設定で片方だけ）のときは開いておく。
    if (roots.length === 1) this.expanded.add(roots[0]!.key);
    const fragment = document.createDocumentFragment();
    for (const node of roots) fragment.append(this.build(node, 0));
    this.element.replaceChildren(fragment);
    if (this.selectedKey && this.rows.has(this.selectedKey)) this.select(this.selectedKey);
    else if (this.openedId) this.reveal(this.openedId, true);
  }

  /** 空にする。 */
  clear(): void {
    this.roots = [];
    this.rows.clear();
    this.expanded.clear();
    this.selectedKey = null;
    this.openedId = null;
    this.element.replaceChildren();
  }

  /**
   * マップを開いたことを知らせる。AdvanceMap と同じく、選んでいる項目がそのマップなら（「iniファイル」の下から
   * 開いたときも）その項目を選んだままにし、そうでなければ「ヘッダー」の下で、その項目まで展開して選ぶ。
   */
  setOpened(id: MapId | null): void {
    this.openedId = id;
    for (const row of this.rows.values()) this.decorate(row);
    if (!id) return;
    const selected = this.selectedKey ? this.rows.get(this.selectedKey) : undefined;
    if (selected?.node.mapId && sameId(selected.node.mapId, id)) return;
    this.reveal(id, true);
  }

  /** 開いているマップの項目の文字列（AdvanceMap の題名に使う。選んでいる項目を優先する）。 */
  openedLabel(): string | null {
    const id = this.openedId;
    if (!id) return null;
    const selected = this.selectedKey ? this.rows.get(this.selectedKey) : undefined;
    if (selected?.node.mapId && sameId(selected.node.mapId, id)) return selected.node.label;
    return this.findOpenedPath(id)?.at(-1)?.label ?? null;
  }

  /** 未出力の印を付け直す。 */
  refreshMarks(): void {
    for (const row of this.rows.values()) if (row.node.mapId) this.decorate(row);
  }

  private build(node: TreeNode, depth: number): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "tree-node";
    const element = document.createElement("div");
    element.className = "tree-row";
    element.style.paddingLeft = `${depth * 19 + 2}px`;
    element.dataset.key = node.key;
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    const label = document.createElement("span");
    label.className = "tree-label";
    element.append(icon, label);
    wrap.append(element);
    const row: Row = { node, element, depth, childBox: null };
    this.rows.set(node.key, row);
    this.decorate(row);
    if (node.children && this.expanded.has(node.key)) this.expand(row);
    return wrap;
  }

  private decorate(row: Row): void {
    const { node, element } = row;
    const label = element.lastElementChild as HTMLElement;
    const icon = element.firstElementChild as HTMLElement;
    if (node.mapId) {
      label.textContent = node.label + (this.host.isDirty(node.mapId) ? ja.modifiedMark : "");
      const opened = this.openedId && sameId(this.openedId, node.mapId);
      icon.className = "tree-icon " + (opened ? "icon-map-open" : "icon-map");
    } else {
      label.textContent = node.label;
      icon.className = "tree-icon " + (this.expanded.has(node.key) ? "icon-folder-open" : "icon-folder");
    }
    element.classList.toggle("selected", node.key === this.selectedKey);
  }

  private expand(row: Row): void {
    this.expanded.add(row.node.key);
    if (!row.childBox) {
      const box = document.createElement("div");
      box.className = "tree-children";
      for (const child of row.node.children ?? []) box.append(this.build(child, row.depth + 1));
      row.element.parentElement!.append(box);
      row.childBox = box;
    }
    row.childBox.hidden = false;
    this.decorate(row);
  }

  private collapse(row: Row): void {
    this.expanded.delete(row.node.key);
    if (row.childBox) row.childBox.hidden = true;
    this.decorate(row);
  }

  private toggle(row: Row): void {
    if (this.expanded.has(row.node.key)) this.collapse(row);
    else this.expand(row);
  }

  private activate(row: Row): void {
    if (row.node.mapId) this.host.openMap(row.node.mapId);
    else if (row.node.children) this.toggle(row);
  }

  private select(key: string): void {
    const prev = this.selectedKey ? this.rows.get(this.selectedKey) : undefined;
    this.selectedKey = key;
    if (prev) this.decorate(prev);
    const row = this.rows.get(key);
    if (!row) return;
    this.decorate(row);
    row.element.scrollIntoView({ block: "nearest" });
  }

  /** マップの項目を探す（「ヘッダー」の下を先に、無ければほかの根の下）。 */
  private findOpenedPath(id: MapId): TreeNode[] | null {
    const header = this.roots.find((r) => r.key === HEADER_ROOT_KEY);
    const order = header ? [header, ...this.roots.filter((r) => r !== header)] : this.roots;
    for (const root of order) {
      const path = findPath(root, id);
      if (path) return path;
    }
    return null;
  }

  /** マップの項目を探し、そこまで展開する。 */
  private reveal(id: MapId, selectIt: boolean): void {
    const path = this.findOpenedPath(id);
    if (!path) return;
    for (const node of path.slice(0, -1)) {
      const row = this.rows.get(node.key);
      if (row) this.expand(row);
    }
    if (selectIt) this.select(path[path.length - 1]!.key);
  }

  private onKey(e: KeyboardEvent): void {
    const visible = this.visibleRows();
    const index = visible.findIndex((r) => r.node.key === this.selectedKey);
    const row = visible[index];
    switch (e.key) {
      case "ArrowDown":
        this.select((visible[Math.min(visible.length - 1, index + 1)] ?? visible[0])!.node.key);
        break;
      case "ArrowUp":
        if (index > 0) this.select(visible[index - 1]!.node.key);
        break;
      case "ArrowRight":
        if (row?.node.children) this.expand(row);
        break;
      case "ArrowLeft":
        if (row?.node.children && this.expanded.has(row.node.key)) this.collapse(row);
        else if (row) {
          const parent = visible.slice(0, index).reverse().find((r) => r.depth < row.depth);
          if (parent) this.select(parent.node.key);
        }
        break;
      case "Enter":
        if (row) this.activate(row);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private visibleRows(): Row[] {
    const out: Row[] = [];
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const n of nodes) {
        const row = this.rows.get(n.key);
        if (!row) continue;
        out.push(row);
        if (n.children && this.expanded.has(n.key)) walk(n.children);
      }
    };
    walk(this.roots);
    return out;
  }

  private rowOf(target: EventTarget | null): Row | undefined {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>(".tree-row");
    return el?.dataset.key ? this.rows.get(el.dataset.key) : undefined;
  }
}

function sameId(a: MapId, b: MapId): boolean {
  return a.bank === b.bank && a.map === b.map;
}

function findPath(node: TreeNode, id: MapId): TreeNode[] | null {
  if (node.mapId && sameId(node.mapId, id)) return [node];
  for (const child of node.children ?? []) {
    const path = findPath(child, id);
    if (path) return [node, ...path];
  }
  return null;
}
