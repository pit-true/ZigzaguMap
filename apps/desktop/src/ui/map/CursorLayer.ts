import type { Cell, MapView } from "./MapView";

/** プレイヤーの視界（ゲームの画面 240×160 画素 = 15×10 マス）。 */
export const PLAYER_VIEW = { width: 15, height: 10 } as const;

/**
 * 主人公のマスが視界の左上から何マス目か（0 から。Q7 の推奨で仮の値: 左に 7 マス・上に 4 マス）。
 * Phase6（#13）で ROM のカメラ処理に合わせて置き換える。
 */
export const PLAYER_VIEW_ORIGIN = { x: 7, y: 4 } as const;

/** カーソルの枠の大きさを決めるもの（タブが渡す。無ければ 1×1）。 */
export type CursorSize = () => { width: number; height: number };

/**
 * マップ表示の上の補助の枠（Phase5 #391）: カーソルの枠（C）とプレイヤーの視界の枠（V）。
 * どちらも `MapView` のステージの上に置いた枠の要素だけで描く（マップの大きさの Canvas を持たない。メモリは増えない）。
 * マウスが乗っているマス（主マップの左上が原点。隣の帯の上も）に合わせて動かし、マップの外へ出たら隠す。
 * グリッドの形は MapView のグリッドの Canvas（今までと同じ所）で描く。
 */
export class CursorLayer {
  private readonly cursor: HTMLElement;
  private readonly sight: HTMLElement;
  private cell: Cell | null = null;
  private cursorOn = false;
  private sightOn = false;

  constructor(
    private readonly view: MapView,
    /** カーソルの枠の大きさ（マス）。 */
    private readonly size: CursorSize = () => ({ width: 1, height: 1 }),
  ) {
    this.cursor = frame("map-cursor-frame");
    this.sight = frame("map-sight-frame");
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
  get state(): { cell: Cell | null; cursor: Rect | null; sight: Rect | null } {
    return { cell: this.cell, cursor: this.cursorRect(), sight: this.sightRect() };
  }

  private cursorRect(): Rect | null {
    if (!this.cursorOn || !this.cell) return null;
    const s = this.size();
    return { x: this.cell.x, y: this.cell.y, width: Math.max(1, s.width), height: Math.max(1, s.height) };
  }

  private sightRect(): Rect | null {
    if (!this.sightOn || !this.cell) return null;
    return { x: this.cell.x - PLAYER_VIEW_ORIGIN.x, y: this.cell.y - PLAYER_VIEW_ORIGIN.y, width: PLAYER_VIEW.width, height: PLAYER_VIEW.height };
  }

  /** 枠を置き直す（倍率・余白・選択が変わったときも呼ぶ）。 */
  redraw(): void {
    place(this.cursor, this.cursorRect(), this.view);
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
