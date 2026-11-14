import { BLOCK_PIXELS, type Margins } from "@zigzagumap/core";
import type { MapImage } from "./MapImage";

/** マス目の位置。 */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/**
 * マップの表示領域（スクロールつき）。下から順に、ブロック画像の Canvas、重ね描き用の Canvas（移動許可やイベント）、
 * グリッドの Canvas を重ねる。ブロック画像は等倍で持ち、拡大は表示の大きさだけ変える。
 * 重ね描きとグリッドは表示の大きさで描く（文字や線をにじませないため）。
 */
export class MapView {
  readonly element: HTMLElement;
  readonly stage: HTMLElement;
  private readonly base: HTMLCanvasElement;
  private readonly baseContext: CanvasRenderingContext2D;
  /** 重ね描き用（タブが描く）。 */
  readonly layer: HTMLCanvasElement;
  readonly layerContext: CanvasRenderingContext2D;
  private readonly gridCanvas: HTMLCanvasElement;
  private image: MapImage | null = null;
  private drawnVersion = -1;
  private zoomValue = 1;
  private gridOn = false;
  /** 主マップのまわりの余白（マス。隣のマップの帯の分）。 */
  private marginsValue: Margins = NO_MARGINS;
  /** 主マップの枠（隣のマップがあるときだけ出す）。 */
  private readonly frame: HTMLElement;
  /** `toPng` の前に呼ぶ（隠れているタブの隣の帯を描くため。NeighborLayer が入れる）。 */
  beforePng: (() => void) | null = null;
  /** 新しいマップを出したあと、最初に余白が付いたらスクロールを合わせる。 */
  private scrollPending = false;

  constructor(className: string) {
    this.element = document.createElement("div");
    this.element.className = `map-scroll ${className}`;
    this.stage = document.createElement("div");
    this.stage.className = "map-stage";
    this.base = canvas("map-base");
    this.baseContext = this.base.getContext("2d")!;
    this.layer = canvas("map-layer");
    this.layerContext = this.layer.getContext("2d")!;
    this.gridCanvas = canvas("map-grid");
    this.frame = document.createElement("div");
    this.frame.className = "map-frame";
    this.frame.hidden = true;
    this.stage.append(this.base, this.layer, this.gridCanvas, this.frame);
    this.element.append(this.stage);
    this.element.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** 表示倍率（1 か 2）。 */
  get zoom(): number {
    return this.zoomValue;
  }

  /** 1 マスの表示上の大きさ。 */
  get cellSize(): number {
    return BLOCK_PIXELS * this.zoomValue;
  }

  /** 表示するマップを変える（null で空）。 */
  setImage(image: MapImage | null): void {
    if (image !== this.image) this.scrollPending = true;
    this.image = image;
    this.drawnVersion = -1;
    this.layout();
    this.sync();
  }

  /** 拡大とグリッドを設定する。 */
  configure(zoom: number, grid: boolean): void {
    if (zoom === this.zoomValue && grid === this.gridOn) return;
    this.zoomValue = zoom;
    this.gridOn = grid;
    this.layout();
  }

  /** ブロック画像を最新にする（変わった範囲だけ写す）。 */
  sync(): void {
    const image = this.image;
    if (!image) return;
    const rect = this.drawnVersion < 0 ? { x: 0, y: 0, width: image.image.width, height: image.image.height } : image.dirtySince(this.drawnVersion);
    if (rect) this.baseContext.putImageData(image.imageData, 0, 0, rect.x, rect.y, rect.width, rect.height);
    this.drawnVersion = image.version;
  }

  /** 重ね描き（イベントの箱・移動許可）を隠しているか（#238。Ctrl を押している間）。 */
  get overlayHidden(): boolean {
    return this.layer.style.visibility === "hidden";
  }

  /** 重ね描きを隠す・出す（#238）。画像に撮るとき（toPng）も隠したまま撮る。 */
  setOverlayHidden(hidden: boolean): void {
    this.layer.style.visibility = hidden ? "hidden" : "";
  }

  /** 主マップの大きさ（マス。マップが無ければ 0）。 */
  get mapSize(): { width: number; height: number } {
    return { width: this.image?.width ?? 0, height: this.image?.height ?? 0 };
  }

  /** 主マップのまわりの余白（マス）。 */
  get margins(): Margins {
    return this.marginsValue;
  }

  /** 主マップの左上の、ステージの中の位置（表示上の画素）。 */
  get originPx(): { x: number; y: number } {
    return { x: this.marginsValue.left * this.cellSize, y: this.marginsValue.top * this.cellSize };
  }

  /**
   * 主マップのまわりに余白を付ける（隣のマップの帯を描く場所）。主マップが画面の同じ位置に見えるようにスクロールをずらす。
   * 新しいマップを出したあとの最初の余白では、帯が少し見える位置へスクロールする。
   */
  setMargins(margins: Margins): void {
    const old = this.marginsValue;
    const same = old.left === margins.left && old.top === margins.top && old.right === margins.right && old.bottom === margins.bottom;
    const initial = this.scrollPending && (margins.left > 0 || margins.top > 0);
    if (same && !initial) return;
    const size = this.cellSize;
    const left = this.element.scrollLeft + (margins.left - old.left) * size;
    const top = this.element.scrollTop + (margins.top - old.top) * size;
    this.marginsValue = { ...margins };
    this.layout();
    if (initial) {
      this.scrollPending = false;
      this.element.scrollLeft = Math.max(0, (margins.left - Math.min(margins.left, SCROLL_PEEK)) * size);
      this.element.scrollTop = Math.max(0, (margins.top - Math.min(margins.top, SCROLL_PEEK)) * size);
    } else {
      this.element.scrollLeft = left;
      this.element.scrollTop = top;
    }
  }

  /** マウスの位置のマス（主マップの左上が原点。主マップの外も返す）。ステージの外かマップが無ければ null。 */
  cellAtAny(e: MouseEvent): Cell | null {
    if (!this.image) return null;
    const s = this.stage.getBoundingClientRect();
    if (e.clientX < s.left || e.clientY < s.top || e.clientX >= s.right || e.clientY >= s.bottom) return null;
    return this.rawCellAt(e);
  }

  /** マウスの位置のマス（主マップの左上が原点。ステージの外でも範囲を調べずに返す。ドラッグ用）。 */
  rawCellAt(e: MouseEvent): Cell {
    const r = this.base.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / this.cellSize), y: Math.floor((e.clientY - r.top) / this.cellSize) };
  }

  /** マウスの位置のマス。マップ外なら null。 */
  cellAt(e: MouseEvent): Cell | null {
    if (!this.image) return null;
    const r = this.base.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / this.cellSize);
    const y = Math.floor((e.clientY - r.top) / this.cellSize);
    if (x < 0 || y < 0 || x >= this.image.width || y >= this.image.height) return null;
    return { x, y };
  }

  /**
   * 表示中の画像を PNG にする（重ね描きとグリッドも含め、表示の大きさで）。
   * `withNeighbors` なら余白の隣のマップの帯（`canvas.map-neighbor`）と主マップの枠も含めて、ステージ全体を描く。
   */
  toPng(withNeighbors = false): string | null {
    if (!this.image) return null;
    const out = document.createElement("canvas");
    const o = withNeighbors ? this.originPx : { x: 0, y: 0 };
    // タブが隠れていても撮れるよう、大きさと位置は CSS の値から読む
    out.width = withNeighbors ? Math.round(parseFloat(this.stage.style.width) || this.layer.width) : this.layer.width;
    out.height = withNeighbors ? Math.round(parseFloat(this.stage.style.height) || this.layer.height) : this.layer.height;
    const c = out.getContext("2d")!;
    c.imageSmoothingEnabled = false;
    if (withNeighbors) {
      this.beforePng?.();
      for (const n of this.stage.querySelectorAll<HTMLCanvasElement>("canvas.map-neighbor")) {
        if (!n.hidden) c.drawImage(n, parseFloat(n.style.left), parseFloat(n.style.top), parseFloat(n.style.width), parseFloat(n.style.height));
      }
    }
    c.drawImage(this.base, o.x, o.y, this.layer.width, this.layer.height);
    if (!this.overlayHidden) c.drawImage(this.layer, o.x, o.y);
    c.drawImage(this.gridCanvas, o.x, o.y);
    if (withNeighbors && !this.frame.hidden) {
      c.strokeStyle = FRAME_COLOR;
      c.lineWidth = 1;
      c.strokeRect(o.x + 0.5, o.y + 0.5, this.layer.width - 1, this.layer.height - 1);
    }
    return out.toDataURL("image/png");
  }

  private layout(): void {
    const w = this.image ? this.image.image.width : 0;
    const h = this.image ? this.image.image.height : 0;
    if (this.base.width !== w || this.base.height !== h) {
      this.base.width = w;
      this.base.height = h;
      this.drawnVersion = -1;
    }
    const dw = w * this.zoomValue;
    const dh = h * this.zoomValue;
    const m = this.marginsValue;
    const size = this.cellSize;
    const ox = m.left * size;
    const oy = m.top * size;
    this.stage.style.width = `${dw + (m.left + m.right) * size}px`;
    this.stage.style.height = `${dh + (m.top + m.bottom) * size}px`;
    for (const c of [this.base, this.layer, this.gridCanvas, this.frame]) {
      c.style.left = `${ox}px`;
      c.style.top = `${oy}px`;
      c.style.width = `${dw}px`;
      c.style.height = `${dh}px`;
    }
    this.frame.hidden = !this.image || (m.left === 0 && m.top === 0 && m.right === 0 && m.bottom === 0);
    if (this.layer.width !== dw || this.layer.height !== dh) {
      this.layer.width = dw;
      this.layer.height = dh;
    }
    this.gridCanvas.width = dw;
    this.gridCanvas.height = dh;
    if (this.gridOn && dw > 0) drawGrid(this.gridCanvas, this.cellSize);
    this.sync();
  }
}

/** 余白なし。 */
const NO_MARGINS: Margins = { left: 0, top: 0, right: 0, bottom: 0 };
/** 新しいマップを出したとき、上と左の帯を何マス見せる位置へスクロールするか。 */
const SCROLL_PEEK = 2;
/** 主マップの枠の色（styles/map.css の .map-frame と同じ）。 */
const FRAME_COLOR = "rgba(0, 0, 0, 0.75)";

function canvas(className: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.className = className;
  c.width = 0;
  c.height = 0;
  return c;
}

/**
 * 16px（拡大時 32px）ごとに、AdvanceMap と同じくマスの左端・上端へ黒い線を引く。
 * 線の太さは等倍で 1px、拡大時は 2px（等倍の線を拡大したのと同じ）。
 */
export function drawGrid(target: HTMLCanvasElement, step: number): void {
  const c = target.getContext("2d")!;
  c.clearRect(0, 0, target.width, target.height);
  c.fillStyle = "#000";
  const line = Math.max(1, Math.round(step / 16));
  for (let x = 0; x < target.width; x += step) c.fillRect(x, 0, line, target.height);
  for (let y = 0; y < target.height; y += step) c.fillRect(0, y, target.width, line);
}
