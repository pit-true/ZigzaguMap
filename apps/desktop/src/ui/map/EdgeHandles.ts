import type { Side } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaNeighbors } from "../../i18n/ja.neighbors";
import type { EdgeMenu } from "../connection/EdgeMenu";
import { HANDLE_SIZE } from "./ConnectionHandles";
import type { MapView } from "./MapView";
import "../../styles/connectionHandles.css";

/** 辺のつまみ 1 つ（主マップの辺の中央）。 */
export interface EdgeHandle {
  /** 自動操作で指す名前（`edge:<up|down|left|right>`）。 */
  readonly id: string;
  readonly side: Side;
  /** つまみの中心（主マップの左上が原点のマス）。 */
  readonly at: { readonly x: number; readonly y: number };
  readonly element: HTMLElement;
}

const SIDES: readonly Side[] = ["up", "down", "left", "right"];

/**
 * 主マップの 4 辺の中央のつまみ（マップタブだけ）。右クリックで接続のメニュー（#230）を出す。
 * 隣のマップを「出さない」にしているときは出さない（比較テストで AdvanceMap と同じ見た目にするため）。
 */
export class EdgeHandles {
  private handles: EdgeHandle[] = [];

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly menu: EdgeMenu,
  ) {
    state.on("neighbors", () => this.render());
    state.on("view", () => this.render());
    state.on("map", () => this.clear());
  }

  /** 今のつまみ（自動操作の `connection.handles` 用）。 */
  list(): readonly EdgeHandle[] {
    return this.handles;
  }

  /** 辺のメニューを出す（自動操作の `connection.menu` 用。つまみの上で右クリックしたのと同じ）。 */
  openMenu(side: Side): void {
    const h = this.handles.find((x) => x.side === side);
    if (!h) throw new Error(`辺のつまみがありません: ${side}`);
    const r = h.element.getBoundingClientRect();
    this.menu.open(side, r.left + r.width / 2, r.top + r.height / 2);
  }

  private clear(): void {
    for (const h of this.handles) h.element.remove();
    this.handles = [];
  }

  private render(): void {
    this.clear();
    const main = this.state.map;
    if (!main || this.state.settings.data.neighborView === "off") return;
    const w = main.doc.width;
    const h = main.doc.height;
    for (const side of SIDES) {
      const at = side === "up" ? { x: w / 2, y: 0 } : side === "down" ? { x: w / 2, y: h } : side === "left" ? { x: 0, y: h / 2 } : { x: w, y: h / 2 };
      const el = document.createElement("div");
      el.className = `conn-edge conn-edge-${side}`;
      el.dataset["autoId"] = `edge:${side}`;
      el.title = jaNeighbors.edgeHint;
      const handle: EdgeHandle = { id: `edge:${side}`, side, at, element: el };
      this.place(handle);
      el.addEventListener("pointerdown", (e) => {
        // 下のマップへ描かないよう、ステージへは伝えない
        e.stopPropagation();
        if (e.button === 2) e.preventDefault();
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.menu.open(side, e.clientX, e.clientY);
      });
      this.view.stage.append(el);
      this.handles.push(handle);
    }
  }

  private place(h: EdgeHandle): void {
    const size = this.view.cellSize;
    const o = this.view.originPx;
    const stageW = parseFloat(this.view.stage.style.width) || 0;
    const stageH = parseFloat(this.view.stage.style.height) || 0;
    // ステージの外にはみ出さないようにする（余白の無い辺では、主マップの内側に寄せる）
    const x = Math.min(Math.max(o.x + h.at.x * size - HANDLE_SIZE / 2, 0), Math.max(0, stageW - HANDLE_SIZE));
    const y = Math.min(Math.max(o.y + h.at.y * size - HANDLE_SIZE / 2, 0), Math.max(0, stageH - HANDLE_SIZE));
    h.element.style.left = `${x}px`;
    h.element.style.top = `${y}px`;
  }
}
