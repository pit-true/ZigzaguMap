import type { MapId } from "@zigzagumap/core";
import type { TreeNode } from "../app/MapTreeModel";
import { HEADER_ROOT_KEY, treeMark, type TreeMark } from "../app/MapTreeModel";
import { labelMatches } from "../app/mapFind";
import { ja } from "../i18n/ja";
import { jaMapList } from "../i18n/ja.mapList";

/** マップ一覧が使う窓口。 */
export interface MapTreeHost {
  /** マップを開く（ダブルクリックか Enter）。 */
  openMap(id: MapId): void;
  /** 未出力か。 */
  isDirty(id: MapId): boolean;
  /** 「マップファイル」の項目を開く（ダブルクリックか Enter）。 */
  openMapFile?(path: string, name: string): void;
  /** サムネイルを出すか（#315。設定でオンのとき）。 */
  showThumbnails?(): boolean;
  /** マップの縮小（まだできていなければ null）。 */
  thumbnail?(id: MapId): ImageData | null;
  /** 開いている枝に見えているマップ（縮小を作る対象。枝を開閉・一覧を作り直したときに知らせる。#315）。 */
  thumbnailsWanted?(ids: readonly MapId[]): void;
  /** 読み込めなかったマップか（Phase5 #401。名前の前の印）。 */
  loadFailed?(id: MapId): boolean;
  /** マップの項目の右クリック（Phase5 #401。`x`・`y` は画面の位置）。 */
  contextMenu?(id: MapId, label: string, x: number, y: number): void;
}

/** 一覧の項目の情報（自動操作の `tree.list`）。 */
export interface TreeItemInfo {
  readonly key: string;
  readonly text: string;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly opened: boolean;
  readonly dirty: boolean;
  /** 名前の前の印（#401）。 */
  readonly mark: TreeMark;
  readonly mapId: MapId | null;
}

/** 描いた行。 */
interface Row {
  readonly node: TreeNode;
  readonly element: HTMLElement;
  readonly depth: number;
  /** 親の行（根なら null）。 */
  readonly parent: Row | null;
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
  /** 絞り込む前の全項目（#237）。 */
  private allRoots: readonly TreeNode[] = [];
  /** 絞り込みの文字列（空なら絞り込まない）。 */
  private filterText = "";
  /** 名前のほかに、マップの番号で絞る条件（#305 の「場所:」「地形:」。無ければ null）。 */
  private filterMatch: ((id: MapId) => boolean) | null = null;
  /** 絞り込みの入力そのもの（同じ入力なら作り直さない）。 */
  private filterKey = "";
  /** 絞り込みを始める前の開いていた枝（絞り込みを消したら戻す）。 */
  private savedExpanded: Set<string> | null = null;
  private selectedKey: string | null = null;
  private openedId: MapId | null = null;
  /** 見えているマップを知らせる待ち（枝の開閉が続いても 1 回にまとめる）。 */
  private wantedPending = false;

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
    // マップの項目の右クリック（#401。開く・名前と番号のコピー・複製）
    this.element.addEventListener("contextmenu", (e) => {
      const row = this.rowOf(e.target);
      if (!row?.node.mapId || row.node.filePath !== undefined || !this.host.contextMenu) return;
      e.preventDefault();
      this.select(row.node.key);
      this.host.contextMenu(row.node.mapId, row.node.label, e.clientX, e.clientY);
    });
  }

  /** 一覧を作り直す（展開状態はできるだけ残す）。 */
  show(roots: readonly TreeNode[]): void {
    this.allRoots = roots;
    this.render();
  }

  /**
   * 絞り込む（#237）。項目の文（マップ名と「(バンク.マップ)」）の部分一致で、合う項目とその親だけを出し、枝は全部開く。
   * グループの名前が合えば中身を全部出す。空にすると元の開き方に戻す。
   */
  setFilter(text: string, match: ((id: MapId) => boolean) | null = null, key: string = text): void {
    const next = text.trim();
    const nextKey = key.trim();
    if (nextKey === this.filterKey) return;
    const wasActive = this.filterKey !== "";
    const active = nextKey !== "";
    if (active && !wasActive) this.savedExpanded = new Set(this.expanded);
    if (!active && this.savedExpanded) {
      this.expanded.clear();
      for (const k of this.savedExpanded) this.expanded.add(k);
      this.savedExpanded = null;
    }
    this.filterText = next;
    this.filterMatch = active ? match : null;
    this.filterKey = nextKey;
    this.render();
  }

  /** 絞り込みの入力（「場所:」などの語も含む）。 */
  get filter(): string {
    return this.filterKey;
  }

  private render(): void {
    const filtering = this.filterKey !== "";
    const roots = filtering ? filterNodes(this.allRoots, this.filterText, this.filterMatch) : this.allRoots;
    if (filtering) for (const key of branchKeys(roots)) this.expanded.add(key);
    this.roots = roots;
    this.rows.clear();
    // 根が 1 つだけ（マップの表示設定で片方だけ）のときは開いておく。
    if (roots.length === 1) this.expanded.add(roots[0]!.key);
    const fragment = document.createDocumentFragment();
    for (const node of roots) fragment.append(this.build(node, 0, null));
    this.element.replaceChildren(fragment);
    if (this.selectedKey && this.rows.has(this.selectedKey)) this.select(this.selectedKey);
    else if (this.openedId) this.reveal(this.openedId, true);
    this.scheduleWanted();
  }

  /** 空にする。 */
  clear(): void {
    this.roots = [];
    this.allRoots = [];
    this.rows.clear();
    this.expanded.clear();
    this.selectedKey = null;
    this.openedId = null;
    this.element.replaceChildren();
    this.scheduleWanted();
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

  /** 全項目（子の行をまだ作っていない項目も含む。自動操作の `tree.list` 用）。文字列は画面と同じく未出力の印を含む。 */
  items(): TreeItemInfo[] {
    const out: TreeItemInfo[] = [];
    const walk = (nodes: readonly TreeNode[], depth: number): void => {
      for (const n of nodes) {
        const dirty = n.mapId ? this.host.isDirty(n.mapId) : false;
        out.push({
          key: n.key,
          text: n.label + (dirty ? ja.modifiedMark : ""),
          depth,
          hasChildren: n.children !== undefined && n.children.length > 0,
          expanded: this.expanded.has(n.key),
          selected: n.key === this.selectedKey,
          opened: !!(n.mapId && this.openedId && sameId(n.mapId, this.openedId)),
          dirty,
          mark: n.mapId && n.filePath === undefined ? this.markOf(n.mapId) : null,
          mapId: n.mapId ?? null,
        });
        if (n.children) walk(n.children, depth + 1);
      }
    };
    walk(this.roots, 0);
    return out;
  }

  /** サムネイルを描き直す（`id` のマップの行だけ。null なら全部。#315）。見えている行の分しか描かないので、軽い。 */
  refreshThumbnails(id: MapId | null = null): void {
    for (const row of this.rows.values()) {
      if (!row.node.mapId || (id && !sameId(row.node.mapId, id))) continue;
      if (!this.isShown(row)) continue;
      const thumb = row.element.querySelector<HTMLCanvasElement>("canvas.tree-thumb");
      if (thumb) delete thumb.dataset["drawn"];
      this.decorateThumbnail(row);
    }
  }

  /** サムネイルを描いた行の数（自動操作用）。 */
  thumbnailRows(): number {
    let n = 0;
    for (const row of this.rows.values()) if (row.element.querySelector("canvas.tree-thumb[data-drawn]")) n++;
    return n;
  }

  /** 開いている枝に見えているマップ（同じマップが 2 つの根の下にあれば 1 つ。#315）。 */
  wantedMapIds(): MapId[] {
    const out = new Map<string, MapId>();
    for (const row of this.visibleRows()) {
      const id = row.node.mapId;
      if (id && row.node.filePath === undefined) out.set(`${id.bank}.${id.map}`, id);
    }
    return [...out.values()];
  }

  /** 行が見えているか（親が全部開いている）。 */
  private isShown(row: Row): boolean {
    for (let p = row.parent; p; p = p.parent) if (!this.expanded.has(p.node.key)) return false;
    return true;
  }

  /** 見えているマップが変わったかもしれないので、まとめてから知らせる。 */
  private scheduleWanted(): void {
    if (this.wantedPending || !this.host.thumbnailsWanted) return;
    this.wantedPending = true;
    queueMicrotask(() => {
      this.wantedPending = false;
      this.host.thumbnailsWanted?.(this.wantedMapIds());
    });
  }

  /** 枝を開閉したあと、その下の行の縮小を付け外しする（閉じた枝の縮小の Canvas は捨てる）。 */
  private decorateBranch(row: Row): void {
    if (!this.host.showThumbnails?.()) return;
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const n of nodes) {
        const r = this.rows.get(n.key);
        if (!r) continue;
        if (n.mapId) this.decorateThumbnail(r);
        else if (n.children) walk(n.children);
      }
    };
    walk(row.node.children ?? []);
  }

  /** マップの行の縮小（#315。設定でオフか、閉じた枝の中なら外す）。 */
  private decorateThumbnail(row: Row): void {
    const id = row.node.mapId;
    let thumb = row.element.querySelector<HTMLCanvasElement>("canvas.tree-thumb");
    if (!id || !this.host.showThumbnails?.() || !this.isShown(row)) {
      thumb?.remove();
      row.element.classList.remove("with-thumb");
      return;
    }
    if (!thumb) {
      thumb = document.createElement("canvas");
      thumb.className = "tree-thumb";
      thumb.width = 48;
      thumb.height = 48;
      row.element.firstElementChild!.after(thumb);
      row.element.classList.add("with-thumb");
    }
    if (thumb.dataset["drawn"] !== undefined) return;
    const image = this.host.thumbnail?.(id) ?? null;
    if (image) {
      thumb.getContext("2d")!.putImageData(image, 0, 0);
      thumb.dataset["drawn"] = "";
    }
  }

  /** 項目の行（親を開いて行を作る）。無ければ null。自動操作がマウスの出来事を送るのに使う。 */
  rowElement(key: string): HTMLElement | null {
    const path = findKeyPath(this.roots, key);
    if (!path) return null;
    for (const node of path.slice(0, -1)) {
      const row = this.rows.get(node.key);
      if (row && !this.expanded.has(node.key)) this.expand(row);
    }
    return this.rows.get(key)?.element ?? null;
  }

  private build(node: TreeNode, depth: number, parent: Row | null): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "tree-node";
    const element = document.createElement("div");
    element.className = "tree-row";
    element.style.paddingLeft = `${depth * 19 + 2}px`;
    element.dataset.key = node.key;
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    const mark = document.createElement("span");
    mark.className = "tree-mark";
    const label = document.createElement("span");
    label.className = "tree-label";
    element.append(icon, mark, label);
    wrap.append(element);
    const row: Row = { node, element, depth, parent, childBox: null };
    this.rows.set(node.key, row);
    this.decorate(row);
    if (node.children && this.expanded.has(node.key)) this.expand(row);
    return wrap;
  }

  private decorate(row: Row): void {
    const { node, element } = row;
    const label = element.lastElementChild as HTMLElement;
    const icon = element.firstElementChild as HTMLElement;
    const mark = label.previousElementSibling as HTMLElement;
    const kind = node.mapId && node.filePath === undefined ? this.markOf(node.mapId) : null;
    mark.className = kind ? `tree-mark mark-${kind}` : "tree-mark";
    mark.title = kind ? jaMapList.marks[kind] : "";
    if (node.filePath !== undefined) {
      label.textContent = node.label;
      element.dataset["autoId"] = `tree.mapFile.${node.key.slice(2)}`;
      icon.className = "tree-icon icon-map";
    } else if (node.mapId) {
      label.textContent = node.label + (this.host.isDirty(node.mapId) ? ja.modifiedMark : "");
      const opened = this.openedId && sameId(this.openedId, node.mapId);
      icon.className = "tree-icon " + (opened ? "icon-map-open" : "icon-map");
      this.decorateThumbnail(row);
    } else {
      label.textContent = node.label;
      icon.className = "tree-icon " + (this.expanded.has(node.key) ? "icon-folder-open" : "icon-folder");
      if (row.depth === 0) element.dataset["autoId"] = `tree.root.${node.key}`;
    }
    element.classList.toggle("selected", node.key === this.selectedKey);
  }

  /** 名前の前の印（#401）。 */
  private markOf(id: MapId): TreeMark {
    return treeMark({
      failed: !!this.host.loadFailed?.(id),
      dirty: this.host.isDirty(id),
      opened: !!this.openedId && sameId(this.openedId, id),
    });
  }

  private expand(row: Row): void {
    this.expanded.add(row.node.key);
    if (!row.childBox) {
      const box = document.createElement("div");
      box.className = "tree-children";
      // 子の行は、開いた印を付けてから作る（見えている行にだけ縮小を付けるため）
      row.childBox = box;
      for (const child of row.node.children ?? []) box.append(this.build(child, row.depth + 1, row));
      row.element.parentElement!.append(box);
    } else {
      this.decorateBranch(row);
    }
    row.childBox.hidden = false;
    this.decorate(row);
    this.scheduleWanted();
  }

  private collapse(row: Row): void {
    this.expanded.delete(row.node.key);
    if (row.childBox) row.childBox.hidden = true;
    this.decorate(row);
    this.decorateBranch(row);
    this.scheduleWanted();
  }

  private toggle(row: Row): void {
    if (this.expanded.has(row.node.key)) this.collapse(row);
    else this.expand(row);
  }

  private activate(row: Row): void {
    if (row.node.mapId) this.host.openMap(row.node.mapId);
    else if (row.node.filePath !== undefined) this.host.openMapFile?.(row.node.filePath, row.node.label);
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
    // 行に直接送られたキー（自動操作の key 命令）は、その行を選んでから扱う。
    const target = this.rowOf(e.target);
    if (target && target.node.key !== this.selectedKey) this.select(target.node.key);
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

function findKeyPath(nodes: readonly TreeNode[], key: string): TreeNode[] | null {
  for (const n of nodes) {
    if (n.key === key) return [n];
    const sub = findKeyPath(n.children ?? [], key);
    if (sub) return [n, ...sub];
  }
  return null;
}

function findPath(node: TreeNode, id: MapId): TreeNode[] | null {
  if (node.mapId && sameId(node.mapId, id)) return [node];
  for (const child of node.children ?? []) {
    const path = findPath(child, id);
    if (path) return [node, ...path];
  }
  return null;
}

/**
 * 絞り込んだ項目（合う項目と、その親。グループの名前が合えば中身を全部）。`match` があれば、マップの番号でも絞る
 * （「マップファイル」の項目は番号を持たないので出さない。グループの名前が合っても中身を 1 つずつ確かめる）。
 */
function filterNodes(nodes: readonly TreeNode[], query: string, match: ((id: MapId) => boolean) | null = null): TreeNode[] {
  const out: TreeNode[] = [];
  const named = (label: string): boolean => query === "" || labelMatches(label, query);
  for (const n of nodes) {
    if (n.mapId || n.filePath !== undefined) {
      if (match && (!n.mapId || !match(n.mapId))) continue;
      if (named(n.label)) out.push(n);
      continue;
    }
    if (query !== "" && labelMatches(n.label, query) && n.children && n.children.length > 0) {
      const all = match ? filterNodes(n.children, "", match) : n.children;
      if (all.length > 0) out.push(match ? { ...n, children: all } : n);
      continue;
    }
    const children = filterNodes(n.children ?? [], query, match);
    if (children.length > 0) out.push({ ...n, children });
  }
  return out;
}

/** 子を持つ項目の鍵（全部開くため）。 */
function branchKeys(nodes: readonly TreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      out.push(n.key);
      out.push(...branchKeys(n.children));
    }
  }
  return out;
}
