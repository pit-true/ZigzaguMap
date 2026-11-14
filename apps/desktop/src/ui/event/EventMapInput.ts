import type { MapView } from "../map/MapView";

/** マス（マップの外も含む。左・上の外は負の値）。 */
export interface RawCell {
  readonly x: number;
  readonly y: number;
}

/** マップ上の操作の受け手（イベントタブ）。 */
export interface EventMapHandlers {
  /** 押した（左右どちらのボタンでも、修飾キーに関係なく同じ）。イベントをつかんだら true。 */
  press(cell: RawCell): boolean;
  /** つかんだまま別のマスへ動かした。 */
  drag(cell: RawCell): void;
  /** 離した。 */
  release(): void;
  /** ダブルクリック。 */
  activate(cell: RawCell): void;
  /** ボタンを押していないときのマウス移動（ステータスバー）。マップの外なら null。 */
  hover(cell: RawCell | null): void;
  /** 右クリックのメニュー（`x`・`y` は画面の位置）。 */
  contextMenu?(cell: RawCell, x: number, y: number): void;
}

/**
 * イベントタブのマップ上のマウス操作（AdvanceMap の EventBox）。
 * - 左・右どちらのボタンでもクリックで選び、ドラッグで動かす（AdvanceMap はボタンを区別しない）。
 * - ドラッグはマップの外まで追い、外のマスの座標も渡す（AdvanceMap と同じく範囲外の座標になる）。
 * - 同じマスの上の細かい動きは無視する。
 */
export class EventMapInput {
  private dragging: { pointerId: number; button: number; last: RawCell } | null = null;

  constructor(
    private readonly view: MapView,
    handlers: EventMapHandlers,
  ) {
    const stage = view.stage;
    stage.addEventListener("pointerdown", (e) => {
      if (this.dragging || (e.button !== 0 && e.button !== 2)) return;
      const cell = this.cellAt(e);
      if (!cell || !this.inside(cell)) return;
      e.preventDefault();
      if (!handlers.press(cell)) return;
      stage.setPointerCapture(e.pointerId);
      this.dragging = { pointerId: e.pointerId, button: e.button, last: cell };
    });
    stage.addEventListener("pointermove", (e) => {
      const cell = this.cellAt(e);
      const d = this.dragging;
      if (!d) {
        handlers.hover(cell && this.inside(cell) ? cell : null);
        return;
      }
      if (!cell || (cell.x === d.last.x && cell.y === d.last.y)) return;
      d.last = cell;
      handlers.drag(cell);
    });
    const finish = (e: PointerEvent): void => {
      const d = this.dragging;
      if (!d || e.pointerId !== d.pointerId || e.button !== d.button) return;
      this.dragging = null;
      if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
      handlers.release();
    };
    stage.addEventListener("pointerup", finish);
    stage.addEventListener("pointercancel", finish);
    stage.addEventListener("pointerleave", () => {
      if (!this.dragging) handlers.hover(null);
    });
    stage.addEventListener("contextmenu", (e) => {
      const cell = this.cellAt(e);
      if (!cell || !this.inside(cell) || !handlers.contextMenu) return;
      e.preventDefault();
      handlers.contextMenu(cell, e.clientX, e.clientY);
    });
    stage.addEventListener("dblclick", (e) => {
      const cell = this.cellAt(e);
      if (cell && this.inside(cell)) handlers.activate(cell);
    });
  }

  /** マウスの位置のマス（主マップの左上が原点。マップの外も含む）。マップが無ければ null。 */
  private cellAt(e: MouseEvent): RawCell | null {
    if (this.view.stage.clientWidth === 0) return null;
    return this.view.rawCellAt(e);
  }

  /** 主マップの中か（隣のマップの帯の上は含めない）。 */
  private inside(cell: RawCell): boolean {
    const size = this.view.mapSize;
    return cell.x >= 0 && cell.y >= 0 && cell.x < size.width && cell.y < size.height;
  }
}
