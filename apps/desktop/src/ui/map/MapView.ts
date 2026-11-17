import { BLOCK_PIXELS, type Margins } from "@zigzagumap/core";
import type { MapImage } from "./MapImage";
import { DEFAULT_GRID_STYLE, dashPattern, gridLinePositions, isDefaultGridStyle, sameGridStyle, type GridStyle } from "./gridStyle";

/** マス目の位置。 */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** 拡大の上限（Ctrl＋ホイール。#316）。 */
export const MAX_MAP_ZOOM = 8;

/**
 * マップの表示領域（スクロールつき）。下から順に、ブロック画像の Canvas、重ね描き用の Canvas（移動許可やイベント）、
 * グリッドの Canvas を重ねる。ブロック画像は等倍で持ち、拡大は表示の大きさだけ変える。
 * 重ね描きとグリッドは表示の大きさで描く（文字や線をにじませないため）。
 *
 * 3〜8 倍（#316）: 重ね描きなどは 2 倍の大きさで描き、ステージ全体を CSS の拡大（transform）で表示の大きさにする。
 * 拡大した画像は持たない（メモリは 2 倍のときと同じ）。拡大していないとき（1 倍・2 倍）は今までと同じ作りと操作。
 * `cellSize` は描く大きさ（1 倍か 2 倍）、`screenCellSize` は画面の上の大きさ（マウスの位置からマスを求めるとき）。
 */
export class MapView {
  readonly element: HTMLElement;
  /** スクロールの大きさを決める枠（拡大したステージの大きさ）。 */
  private readonly sizer: HTMLElement;
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
  /** グリッドの形（Phase5 #391。既定は今までの見た目）。 */
  private gridStyle: GridStyle = DEFAULT_GRID_STYLE;
  /** 主マップのまわりの余白（マス。隣のマップの帯の分）。 */
  private marginsValue: Margins = NO_MARGINS;
  private previewMargins: Margins = NO_MARGINS;
  /** 主マップの枠（隣のマップがあるときだけ出す）。 */
  private readonly frame: HTMLElement;
  /** `toPng` の前に呼ぶ（隠れているタブの隣の帯を描くため。NeighborLayer が入れる）。 */
  beforePng: (() => void) | null = null;
  /** 新しいマップを出したあと、最初に余白が付いたらスクロールを合わせる。 */
  private scrollPending = false;
  /** 隠れているタブか（`setDormant`）。 */
  private dormantValue = false;
  /** 隠れていたタブが出たときに呼ぶ（重ね描きを描き直す。タブが入れる）。 */
  readonly wakeListeners: (() => void)[] = [];

  constructor(className: string) {
    this.element = document.createElement("div");
    this.element.className = `map-scroll ${className}`;
    // スクロールの枠（自動操作の `mouse` の `id`。中ボタンのドラッグなど、スクロールしても動かない部品で押すため。#316）
    this.element.dataset["autoId"] = className;
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
    this.sizer = document.createElement("div");
    this.sizer.className = "map-sizer";
    this.sizer.append(this.stage);
    this.element.append(this.sizer);
    this.element.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** 表示倍率（1〜8）。 */
  get zoom(): number {
    return this.zoomValue;
  }

  /** 描く倍率（1 か 2。3 倍より上は 2 倍で描いて CSS で広げる）。 */
  private get drawZoom(): number {
    return Math.min(this.zoomValue, 2);
  }

  /** CSS で広げる割合（2 倍以下なら 1）。 */
  get screenScale(): number {
    return this.zoomValue / this.drawZoom;
  }

  /** 1 マスの描く大きさ（重ね描きの Canvas の上の画素）。 */
  get cellSize(): number {
    return BLOCK_PIXELS * this.drawZoom;
  }

  /** 1 マスの画面の上の大きさ（マウスの位置からマスを求めるとき）。 */
  get screenCellSize(): number {
    return BLOCK_PIXELS * this.zoomValue;
  }

  /** 隠れているタブか。隠れている間は、重ね描きを描かなくてよい（出たときに `wakeListeners` で描き直す）。 */
  get dormant(): boolean {
    return this.dormantValue;
  }

  /**
   * タブが隠れた・出たことを知らせる（Phase4 #318。メモリを減らすため）。隠れている間は、ブロック画像の Canvas を持たず、
   * 重ね描きの Canvas も中身を捨てる（大きさはそのまま。マウスの位置などの計算は変わらない）。出たら全部を描き直す。
   */
  setDormant(dormant: boolean): void {
    if (dormant === this.dormantValue) return;
    this.dormantValue = dormant;
    if (dormant) {
      this.base.width = 0;
      this.base.height = 0;
      this.drawnVersion = -1;
      // 大きさを入れ直すと中身（画素の領域）を捨てる。描かなければ領域は持たない
      const { width, height } = this.layer;
      this.layer.width = width;
      this.layer.height = height;
      return;
    }
    this.layout();
    for (const l of this.wakeListeners) l();
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
    const z = Math.min(MAX_MAP_ZOOM, Math.max(1, Math.round(zoom)));
    if (z === this.zoomValue && grid === this.gridOn) return;
    this.zoomValue = z;
    this.gridOn = grid;
    this.layout();
  }

  /** グリッドの形を変える（表示 > グリッドの設定…。Phase5 #391）。 */
  setGridStyle(style: GridStyle): void {
    if (sameGridStyle(style, this.gridStyle)) return;
    this.gridStyle = style;
    this.layout();
  }

  /**
   * 倍率を変え、画面の (clientX, clientY) の下のマスが同じ場所に見えるようにスクロールする（Ctrl＋ホイール。#316）。
   * 位置が無ければ表示の中央を保つ。
   */
  zoomAt(zoom: number, clientX?: number, clientY?: number): void {
    const z = Math.min(MAX_MAP_ZOOM, Math.max(1, Math.round(zoom)));
    if (z === this.zoomValue) return;
    const r = this.element.getBoundingClientRect();
    const ax = clientX !== undefined ? clientX - r.left : this.element.clientWidth / 2;
    const ay = clientY !== undefined ? clientY - r.top : this.element.clientHeight / 2;
    const old = this.screenCellSize;
    const cx = (this.element.scrollLeft + ax) / old;
    const cy = (this.element.scrollTop + ay) / old;
    this.zoomValue = z;
    this.layout();
    const size = this.screenCellSize;
    this.element.scrollLeft = Math.max(0, cx * size - ax);
    this.element.scrollTop = Math.max(0, cy * size - ay);
  }

  /** ブロック画像を最新にする（変わった範囲だけ写す）。 */
  sync(): void {
    const image = this.image;
    if (!image || this.dormantValue) return;
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
    const a = this.marginsValue, b = this.previewMargins;
    return { left: a.left + b.left, top: a.top + b.top, right: a.right + b.right, bottom: a.bottom + b.bottom };
  }

  /** 仮の主人公の画面をマップ端でも置ける余白。接続の帯とは別に持ち、終了時に外す。 */
  setPreviewMargins(value: Margins): void {
    const old = this.previewMargins;
    if (old.left === value.left && old.top === value.top && old.right === value.right && old.bottom === value.bottom) return;
    const left = this.element.scrollLeft + (value.left - old.left) * this.screenCellSize;
    const top = this.element.scrollTop + (value.top - old.top) * this.screenCellSize;
    this.previewMargins = value;
    this.layout();
    this.element.scrollLeft = left; this.element.scrollTop = top;
  }

  /** 主マップの左上の、ステージの中の位置（表示上の画素）。 */
  get originPx(): { x: number; y: number } {
    return { x: this.margins.left * this.cellSize, y: this.margins.top * this.cellSize };
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
    const size = this.screenCellSize;
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
    return { x: Math.floor((e.clientX - r.left) / this.screenCellSize), y: Math.floor((e.clientY - r.top) / this.screenCellSize) };
  }

  /** マウスの位置のマス。マップ外なら null。 */
  cellAt(e: MouseEvent): Cell | null {
    if (!this.image) return null;
    const r = this.base.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / this.screenCellSize);
    const y = Math.floor((e.clientY - r.top) / this.screenCellSize);
    if (x < 0 || y < 0 || x >= this.image.width || y >= this.image.height) return null;
    return { x, y };
  }

  /**
   * 表示中の画像を PNG にする（重ね描きとグリッドも含め、表示の大きさで）。
   * `withNeighbors` なら余白の隣のマップの帯（`canvas.map-neighbor`）と主マップの枠も含めて、ステージ全体を描く。
   */
  toPng(withNeighbors = false): string | null {
    if (!this.image) return null;
    // 隠れているタブも撮れるよう、撮る間だけ描く
    if (this.dormantValue) {
      this.setDormant(false);
      try {
        return this.toPng(withNeighbors);
      } finally {
        this.setDormant(true);
      }
    }
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
    // Space で重ねたダイブ先・浮上先（ui/map/DiveOverlay.ts。#232）
    for (const d of this.stage.querySelectorAll<HTMLCanvasElement>("canvas.map-dive")) c.drawImage(d, o.x, o.y);
    c.drawImage(this.gridCanvas, o.x, o.y);
    if (withNeighbors && !this.frame.hidden) {
      c.strokeStyle = FRAME_COLOR;
      c.lineWidth = 1;
      c.strokeRect(o.x + 0.5, o.y + 0.5, this.layer.width - 1, this.layer.height - 1);
    }
    return out.toDataURL("image/png");
  }

  /**
   * 今見えている範囲（主マップの左上が原点のマス。小数を含む。主マップの外にはみ出すこともある）。ミニマップの枠（Phase7 #511）。
   */
  visibleCells(): { x: number; y: number; width: number; height: number } {
    const size = this.screenCellSize;
    const m = this.margins;
    return {
      x: this.element.scrollLeft / size - m.left,
      y: this.element.scrollTop / size - m.top,
      width: this.element.clientWidth / size,
      height: this.element.clientHeight / size,
    };
  }

  /** マス (x, y)（小数も可。主マップの左上が原点）が表示の真ん中に来るようにスクロールする（ミニマップを押したとき。#511）。 */
  centerOn(x: number, y: number): void {
    const size = this.screenCellSize;
    const m = this.margins;
    this.element.scrollLeft = Math.max(0, (x + m.left) * size - this.element.clientWidth / 2);
    this.element.scrollTop = Math.max(0, (y + m.top) * size - this.element.clientHeight / 2);
  }

  private layout(): void {
    const w = this.image ? this.image.image.width : 0;
    const h = this.image ? this.image.image.height : 0;
    const bw = this.dormantValue ? 0 : w;
    const bh = this.dormantValue ? 0 : h;
    if (this.base.width !== bw || this.base.height !== bh) {
      this.base.width = bw;
      this.base.height = bh;
      this.drawnVersion = -1;
    }
    const dw = w * this.drawZoom;
    const dh = h * this.drawZoom;
    const m = this.margins;
    const size = this.cellSize;
    const ox = m.left * size;
    const oy = m.top * size;
    const stageW = dw + (m.left + m.right) * size;
    const stageH = dh + (m.top + m.bottom) * size;
    this.stage.style.width = `${stageW}px`;
    this.stage.style.height = `${stageH}px`;
    // 3 倍より上は、ステージを CSS で広げ、スクロールの大きさは外の枠で決める（#316）
    const scale = this.screenScale;
    this.stage.style.transform = scale === 1 ? "" : `scale(${scale})`;
    this.sizer.style.width = `${stageW * scale}px`;
    this.sizer.style.height = `${stageH * scale}px`;
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
    if (this.gridOn && dw > 0) drawGrid(this.gridCanvas, this.cellSize, this.gridStyle);
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
 * `style`（Phase5 #391）で線の間・ずらし・色・線の形を変えられる。既定なら今までと同じ描き方。
 */
export function drawGrid(target: HTMLCanvasElement, step: number, style: GridStyle = DEFAULT_GRID_STYLE): void {
  const c = target.getContext("2d")!;
  c.clearRect(0, 0, target.width, target.height);
  const line = Math.max(1, Math.round(step / 16));
  if (isDefaultGridStyle(style)) {
    c.fillStyle = "#000";
    for (let x = 0; x < target.width; x += step) c.fillRect(x, 0, line, target.height);
    for (let y = 0; y < target.height; y += step) c.fillRect(0, y, target.width, line);
    return;
  }
  c.fillStyle = style.color;
  const { on, off } = dashPattern(style.line, line);
  const run = (length: number, draw: (from: number, len: number) => void): void => {
    if (!Number.isFinite(on)) return draw(0, length);
    for (let p = 0; p < length; p += on + off) draw(p, Math.min(on, length - p));
  };
  for (const x of gridLinePositions(target.width, step, style.width, style.offsetX)) run(target.height, (from, len) => c.fillRect(x, from, line, len));
  for (const y of gridLinePositions(target.height, step, style.height, style.offsetY)) run(target.width, (from, len) => c.fillRect(from, y, len, line));
}
