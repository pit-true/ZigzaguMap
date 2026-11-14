import { MOVEMENT_SHIFT, resolveCell, type MapId } from "@zigzagumap/core";
import type { EditorState, TabId } from "../../app/EditorState";
import type { NeighborFrame, NeighborService } from "../../app/neighbors/NeighborService";
import { MOVEMENT_COLORS, movementLabel } from "../../app/data/movementColors";
import type { MapView } from "./MapView";

/** 隣のマップを暗くする割合（黒を重ねる不透明度）。 */
const NEIGHBOR_SHADE = 0.3;
/** クローンの印の色（人の箱と同じ系統の色を薄くしたもの）。 */
const CLONE_FILL = "rgba(64, 160, 255, 0.45)";
const CLONE_EDGE = "#ffffff";

/** 1 つのタブの描き方。 */
export interface NeighborLayerOptions {
  /** どのタブの MapView か（隠れている間は Canvas を持たない。メモリを抑えるため）。 */
  readonly tab: TabId;
  /** 移動許可も重ねるか（移動エリアタブ）。 */
  readonly movement?: boolean;
  /** 表示 > クローンがオンのとき、このマップの人のクローンを帯の上に描くか（イベントタブ。#242）。 */
  readonly clones?: boolean;
}

/**
 * 1 つのタブの MapView のまわりに、隣のマップの帯を描く（帯 1 枚に Canvas 1 枚。主マップの Canvas より下）。
 * 帯は少し暗くし、主マップには MapView が枠を付ける。帯の上でダブルクリックするとそのマップを開く。
 */
export class NeighborLayer {
  private canvases: HTMLCanvasElement[] = [];
  private frame: NeighborFrame | null = null;

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly service: NeighborService,
    private readonly openMap: (id: MapId) => unknown,
    private readonly options: NeighborLayerOptions,
  ) {
    state.on("neighbors", () => this.show(this.service.frame));
    state.on("view", () => this.draw());
    state.on("tab", () => this.draw());
    // タブが隠れていても画像に撮れるよう、撮る前に描く
    view.beforePng = () => this.draw(true);
    if (options.movement) state.on("opacity", () => this.draw());
    view.stage.addEventListener("dblclick", (e) => {
      const id = this.mapAt(e);
      if (id) void this.openMap(id);
    });
  }

  /** マウスの位置にある隣のマップ（主マップの上や帯の外なら null）。 */
  mapAt(e: MouseEvent): MapId | null {
    const frame = this.frame;
    const cell = this.view.cellAtAny(e);
    const main = this.state.map;
    if (!frame || !cell || !main) return null;
    const hit = resolveCell(frame.layout, { id: main.id, width: main.doc.width, height: main.doc.height }, cell.x, cell.y);
    return hit?.neighbor ? hit.id : null;
  }

  private show(frame: NeighborFrame | null): void {
    const main = this.state.map;
    // 別のマップの帯（作り直しの途中）は出さない
    this.frame = frame && main && frame.main.bank === main.id.bank && frame.main.map === main.id.map ? frame : null;
    if (this.frame || !frame) this.view.setMargins(this.frame?.layout.margins ?? { left: 0, top: 0, right: 0, bottom: 0 });
    this.draw();
  }

  /** つまみのドラッグ中の下見: 接続の番号 `index` の帯を (dx, dy) マスずらして見せる（0, 0 で元へ）。 */
  preview(index: number, dx: number, dy: number): void {
    const bands = this.frame?.bands ?? [];
    const size = this.view.cellSize;
    const origin = this.view.originPx;
    bands.forEach((band, i) => {
      const canvas = this.canvases[i];
      if (!canvas || band.placement.index !== index) return;
      const at = band.placement.bandAt;
      canvas.style.left = `${origin.x + (at.x + dx) * size}px`;
      canvas.style.top = `${origin.y + (at.y + dy) * size}px`;
    });
  }

  /** 帯を描き直す（表示の大きさ・透明度が変わったときも）。タブが隠れていれば Canvas を捨てる（`force` なら描く）。 */
  draw(force = false): void {
    const bands = force || this.state.tab === this.options.tab ? (this.frame?.bands ?? []) : [];
    while (this.canvases.length > bands.length) this.canvases.pop()!.remove();
    while (this.canvases.length < bands.length) {
      const c = document.createElement("canvas");
      c.className = "map-neighbor";
      this.view.stage.prepend(c);
      this.canvases.push(c);
    }
    const size = this.view.cellSize;
    const origin = this.view.originPx;
    const opacity = this.state.settings.data.movementOpacity;
    bands.forEach((band, i) => {
      const canvas = this.canvases[i]!;
      const at = band.placement.bandAt;
      const w = at.width * size;
      const h = at.height * size;
      canvas.style.left = `${origin.x + at.x * size}px`;
      canvas.style.top = `${origin.y + at.y * size}px`;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = w;
      canvas.height = h;
      const c = canvas.getContext("2d")!;
      c.imageSmoothingEnabled = false;
      c.drawImage(band.bitmap, 0, 0, w, h);
      if (this.options.movement) drawMovements(c, band.grid, band.placement.band, size, opacity);
      c.fillStyle = `rgba(0, 0, 0, ${NEIGHBOR_SHADE})`;
      c.fillRect(0, 0, w, h);
      if (this.options.clones && this.state.settings.data.showClones) drawClones(c, band.clones, band.placement.band, size);
    });
  }
}

/** 帯の上にクローンの印（点線の枠）を描く。 */
function drawClones(c: CanvasRenderingContext2D, clones: readonly { x: number; y: number }[], band: { x: number; y: number; width: number; height: number }, size: number): void {
  c.save();
  c.setLineDash([3, 2]);
  c.lineWidth = 2;
  for (const p of clones) {
    const x = p.x - band.x;
    const y = p.y - band.y;
    if (x < 0 || y < 0 || x >= band.width || y >= band.height) continue;
    c.fillStyle = CLONE_FILL;
    c.fillRect(x * size, y * size, size, size);
    c.strokeStyle = CLONE_EDGE;
    c.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
  }
  c.restore();
}

/** 帯の上に移動許可を重ねる（MovementLayer と同じ色と文字）。 */
function drawMovements(
  c: CanvasRenderingContext2D,
  grid: { width: number; cells: Uint16Array },
  band: { x: number; y: number; width: number; height: number },
  size: number,
  opacity: number,
): void {
  c.font = `${Math.round(size * 0.6)}px "MS UI Gothic", sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (let y = 0; y < band.height; y++) {
    for (let x = 0; x < band.width; x++) {
      const value = grid.cells[(band.y + y) * grid.width + band.x + x]! >> MOVEMENT_SHIFT;
      c.globalAlpha = 1 - opacity;
      c.fillStyle = MOVEMENT_COLORS[value] ?? "#000";
      c.fillRect(x * size, y * size, size, size);
      c.globalAlpha = 1;
      c.fillStyle = "#000";
      c.fillText(movementLabel(value), x * size + size / 2, y * size + size / 2 + 1);
    }
  }
}

