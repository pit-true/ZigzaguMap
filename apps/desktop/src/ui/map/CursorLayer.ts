import type { Cell, MapView } from "./MapView";
import { PLAYER_SCREEN_ORIGIN } from "@zigzagumap/core";

/** プレイヤーの視界（ゲームの画面 240×160 画素 = 15×10 マス）。 */
export const PLAYER_VIEW = { width: 15, height: 10 } as const;

/**
 * 主人公のマスが視界の左上から何マス目か。実機の縦8pxの補正も含む。
 */
export const PLAYER_VIEW_ORIGIN = { x: PLAYER_SCREEN_ORIGIN.x / 16, y: PLAYER_SCREEN_ORIGIN.y / 16 } as const;

/**
 * カーソルの枠の形（タブが渡す。無ければ 1×1）。`offsetX`・`offsetY` はマウスのマスから枠の左上へのずれ（ブラシは真ん中に置く）。
 * `cells` は枠の中で描くマス（左上からのずれ。円のブラシ。Phase7 #515）。無ければ矩形の全部。
 */
export interface CursorShape {
  readonly width: number;
  readonly height: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly cells?: readonly { readonly dx: number; readonly dy: number }[];
}

/** カーソルの枠の形を決めるもの。 */
export type CursorSize = () => CursorShape;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * マップ表示の上の補助の枠（Phase5 #391）: カーソルの枠（C）とプレイヤーの視界の枠（V）。
 * どちらも `MapView` のステージの上に置いた枠の要素だけで描く（マップの大きさの Canvas を持たない。メモリは増えない）。
 * マウスが乗っているマス（主マップの左上が原点。隣の帯の上も）に合わせて動かし、マップの外へ出たら隠す。
 * グリッドの形は MapView のグリッドの Canvas（今までと同じ所）で描く。
 */
export class CursorLayer {
  private readonly cursor: HTMLElement;
  private readonly sight: HTMLElement;
  /** 形の枠の線（円のブラシのときだけ中身を入れる）。 */
  private readonly outline: SVGSVGElement;
  private outlineKey = "";
  private cell: Cell | null = null;
  private cursorOn = false;
  private sightOn = false;
  private externalSight = false;

  /** 仮の主人公・再生が実機の枠を描く間は、マウスについてくる仮の枠を隠す。 */
  setExternalSight(on: boolean): void {
    this.externalSight = on;
    this.redraw();
  }

  constructor(
    private readonly view: MapView,
    /** カーソルの枠の大きさ（マス）。 */
    private readonly size: CursorSize = () => ({ width: 1, height: 1 }),
  ) {
    this.cursor = frame("map-cursor-frame");
    this.sight = frame("map-sight-frame");
    this.outline = document.createElementNS(SVG_NS, "svg");
    this.outline.setAttribute("class", "map-cursor-outline");
    this.outline.setAttribute("preserveAspectRatio", "none");
    this.cursor.append(this.outline);
    view.stage.append(this.cursor, this.sight);
    view.stage.addEventListener("pointermove", (e) => this.track(view.cellAtAny(e)));
    view.stage.addEventListener("pointerleave", () => this.track(null));
  }

  /** 表示の切り替え（個人設定から）。 */
  configure(cursor: boolean, sight: boolean): void {
    this.cursorOn = cursor;
    this.sightOn = sight;
    this.redraw();
  }

  /** マウスのマス（自動操作からも使う）。 */
  track(cell: Cell | null): void {
    this.cell = cell;
    this.redraw();
  }

  /** 今の枠の位置（マス。出していなければ null。自動操作用）。 */
  get state(): { cell: Cell | null; cursor: Rect | null; sight: Rect | null; cursorCells: number | null } {
    const cursor = this.cursorRect();
    const cells = cursor ? this.size().cells : undefined;
    return { cell: this.cell, cursor, sight: this.sightRect(), cursorCells: cursor ? (cells?.length ?? cursor.width * cursor.height) : null };
  }

  private cursorRect(): Rect | null {
    if (!this.cursorOn || !this.cell) return null;
    const s = this.size();
    return { x: this.cell.x + (s.offsetX ?? 0), y: this.cell.y + (s.offsetY ?? 0), width: Math.max(1, s.width), height: Math.max(1, s.height) };
  }

  /** 円のブラシのときは、描くマスの外周を線で描く（矩形の全部なら線を消して枠の縁を使う）。 */
  private shapeOutline(r: Rect | null): void {
    const cells = r ? this.size().cells : undefined;
    const shaped = !!r && !!cells && cells.length < r.width * r.height;
    this.cursor.classList.toggle("shaped", shaped);
    const key = shaped ? `${r!.width}x${r!.height}:${cells!.map((c) => `${c.dx},${c.dy}`).join(";")}` : "";
    if (key === this.outlineKey) return;
    this.outlineKey = key;
    this.outline.replaceChildren();
    if (!shaped) return;
    this.outline.setAttribute("viewBox", `0 0 ${r!.width} ${r!.height}`);
    const d = outlinePath(cells!);
    for (const cls of ["shadow", "line"]) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", cls);
      this.outline.append(path);
    }
  }

  private sightRect(): Rect | null {
    if (!this.sightOn || !this.cell || this.externalSight) return null;
    return { x: this.cell.x - PLAYER_VIEW_ORIGIN.x, y: this.cell.y - PLAYER_VIEW_ORIGIN.y, width: PLAYER_VIEW.width, height: PLAYER_VIEW.height };
  }

  /** 枠を置き直す（倍率・余白・選択が変わったときも呼ぶ）。 */
  redraw(): void {
    const cursor = this.cursorRect();
    this.shapeOutline(cursor);
    place(this.cursor, cursor, this.view);
    place(this.sight, this.sightRect(), this.view);
  }
}

/** マスの矩形。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** マスの集まりの外周（隣が集まりに無い辺だけ）の SVG の道。座標はマス単位。 */
function outlinePath(cells: readonly { readonly dx: number; readonly dy: number }[]): string {
  const set = new Set(cells.map((c) => `${c.dx},${c.dy}`));
  const has = (x: number, y: number): boolean => set.has(`${x},${y}`);
  const parts: string[] = [];
  for (const { dx: x, dy: y } of cells) {
    if (!has(x, y - 1)) parts.push(`M${x} ${y}H${x + 1}`);
    if (!has(x, y + 1)) parts.push(`M${x} ${y + 1}H${x + 1}`);
    if (!has(x - 1, y)) parts.push(`M${x} ${y}V${y + 1}`);
    if (!has(x + 1, y)) parts.push(`M${x + 1} ${y}V${y + 1}`);
  }
  return parts.join("");
}

function frame(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.hidden = true;
  return el;
}

function place(el: HTMLElement, r: Rect | null, view: MapView): void {
  if (!r || view.mapSize.width === 0) {
    el.hidden = true;
    return;
  }
  const size = view.cellSize;
  const o = view.originPx;
  el.hidden = false;
  el.style.left = `${o.x + r.x * size}px`;
  el.style.top = `${o.y + r.y * size}px`;
  el.style.width = `${r.width * size}px`;
  el.style.height = `${r.height * size}px`;
}
