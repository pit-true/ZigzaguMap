import { BLOCK_PIXELS } from "@zigzagumap/core";
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
    this.stage.append(this.base, this.layer, this.gridCanvas);
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

  /** マウスの位置のマス。マップ外なら null。 */
  cellAt(e: MouseEvent): Cell | null {
    if (!this.image) return null;
    const r = this.base.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / this.cellSize);
    const y = Math.floor((e.clientY - r.top) / this.cellSize);
    if (x < 0 || y < 0 || x >= this.image.width || y >= this.image.height) return null;
    return { x, y };
  }

  /** 表示中の画像を PNG にする（重ね描きとグリッドも含め、表示の大きさで）。 */
  toPng(): string | null {
    if (!this.image) return null;
    const out = document.createElement("canvas");
    out.width = this.layer.width;
    out.height = this.layer.height;
    const c = out.getContext("2d")!;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.base, 0, 0, out.width, out.height);
    c.drawImage(this.layer, 0, 0);
    c.drawImage(this.gridCanvas, 0, 0);
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
    this.stage.style.width = `${dw}px`;
    this.stage.style.height = `${dh}px`;
    for (const c of [this.base, this.layer, this.gridCanvas]) {
      c.style.width = `${dw}px`;
      c.style.height = `${dh}px`;
    }
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
