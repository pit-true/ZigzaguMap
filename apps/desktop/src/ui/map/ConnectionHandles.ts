import { ShiftConnectionCommand, inverseOf, isVertical, type MapId, type NeighborPlacement } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { NeighborService } from "../../app/neighbors/NeighborService";
import { jaNeighbors } from "../../i18n/ja.neighbors";
import { showEditError } from "../form/inputErrors";
import type { MapView } from "./MapView";
import type { NeighborLayer } from "./NeighborLayer";
import "../../styles/connectionHandles.css";

/** つまみの大きさ（表示上の画素）。 */
export const HANDLE_SIZE = 10;

/** 角のつまみ 1 つ（隣の帯の端）。 */
export interface CornerHandle {
  /** 自動操作で指す名前（`corner:<接続の番号>:<start|end>`）。 */
  readonly id: string;
  readonly placement: NeighborPlacement;
  readonly end: "start" | "end";
  /** つまみの中心（主マップの左上が原点のマス。境界の線の上）。 */
  readonly at: { readonly x: number; readonly y: number };
  readonly element: HTMLElement;
}

/**
 * 隣の帯の角のつまみ（マップタブだけ。#229）。帯の両端（接続の向きと直交する側）に出す。
 * ドラッグするとブロック単位で帯を動かして見せ（下見）、離したら `shiftConnection` を 1 回実行する
 * （相手のマップの、自分を指す逆向きの接続を `-offset` にそろえる。逆の接続が無ければ自分だけ変えて知らせる）。
 */
export class ConnectionHandles {
  private handles: CornerHandle[] = [];

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly service: NeighborService,
    private readonly layer: NeighborLayer,
  ) {
    state.on("neighbors", () => this.render());
    state.on("view", () => this.render());
    state.on("map", () => this.clear());
  }

  /** 今のつまみ（自動操作の `connection.handles` 用）。 */
  list(): readonly CornerHandle[] {
    return this.handles;
  }

  private clear(): void {
    for (const h of this.handles) h.element.remove();
    this.handles = [];
  }

  private render(): void {
    this.clear();
    const frame = this.service.frame;
    const main = this.state.map;
    if (!frame || !main || frame.main.bank !== main.id.bank || frame.main.map !== main.id.map) return;
    for (const band of frame.bands) {
      const p = band.placement;
      const a = p.bandAt;
      const vertical = isVertical(p.direction);
      // 境界の線（上なら主マップの上端、下なら下端、左右も同じ）
      const line = p.side === "up" ? 0 : p.side === "down" ? main.doc.height : p.side === "left" ? 0 : main.doc.width;
      const ends: ["start" | "end", number][] = vertical
        ? [
            ["start", a.x],
            ["end", a.x + a.width],
          ]
        : [
            ["start", a.y],
            ["end", a.y + a.height],
          ];
      for (const [end, pos] of ends) {
        const at = vertical ? { x: pos, y: line } : { x: line, y: pos };
        const el = document.createElement("div");
        el.className = `conn-handle conn-handle-${vertical ? "h" : "v"}`;
        el.dataset["autoId"] = `corner:${p.index}:${end}`;
        el.title = jaNeighbors.cornerHint;
        const handle: CornerHandle = { id: `corner:${p.index}:${end}`, placement: p, end, at, element: el };
        this.place(handle);
        this.attach(handle);
        this.view.stage.append(el);
        this.handles.push(handle);
      }
    }
  }

  private place(h: CornerHandle): void {
    const size = this.view.cellSize;
    const o = this.view.originPx;
    h.element.style.left = `${o.x + h.at.x * size - HANDLE_SIZE / 2}px`;
    h.element.style.top = `${o.y + h.at.y * size - HANDLE_SIZE / 2}px`;
  }

  private attach(h: CornerHandle): void {
    const el = h.element;
    let drag: { pointerId: number; x: number; y: number; delta: number; ready: Promise<boolean> } | null = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || drag) return;
      // 下のマップへ描かないよう、ステージへは伝えない
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 自動操作で作ったイベントは捕まえられないことがある */
      }
      // 相手のマップを先に読み込んでおく（離したときにすぐ実行できるように）
      drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, delta: 0, ready: this.loadPartner(h.placement.id) };
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      e.stopPropagation();
      const size = this.view.cellSize;
      const vertical = isVertical(h.placement.direction);
      const delta = Math.round((vertical ? e.clientX - drag.x : e.clientY - drag.y) / size);
      if (delta === drag.delta) return;
      drag.delta = delta;
      this.layer.preview(h.placement.index, vertical ? delta : 0, vertical ? 0 : delta);
      this.state.setStatus(jaNeighbors.shifting(h.placement.offset + delta));
    });
    const finish = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.stopPropagation();
      const d = drag;
      drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (d.delta === 0) {
        this.layer.preview(h.placement.index, 0, 0);
        return;
      }
      void d.ready.then((ok) => this.shift(h.placement, h.placement.offset + d.delta, ok));
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
  }

  /** 相手のマップを編集用に読み込む（無いマップなら false）。 */
  private async loadPartner(id: MapId): Promise<boolean> {
    const session = this.state.session;
    if (!session || !session.catalog.has(id)) return false;
    try {
      await session.project.load(id);
      return true;
    } catch {
      return false;
    }
  }

  /** ずれを変える（相手も読み込めていればそろえる）。 */
  private shift(p: NeighborPlacement, offset: number, partnerLoaded: boolean): void {
    const session = this.state.session;
    const main = this.state.map;
    if (!session || !main) return;
    const partnerDoc = partnerLoaded ? session.project.loaded(p.id) : undefined;
    const paired = partnerDoc !== undefined && inverseOf(partnerDoc.connections, main.id, p.direction, p.offset) !== null;
    try {
      session.bus.execute(ShiftConnectionCommand.of(main.id, p.index, offset, partnerDoc ? p.id : null));
    } catch (e) {
      this.layer.preview(p.index, 0, 0);
      void showEditError(e);
      return;
    }
    this.state.setStatus(paired ? jaNeighbors.shifted(offset, -offset) : jaNeighbors.shiftedOneSide(offset), undefined, !paired);
  }
}
