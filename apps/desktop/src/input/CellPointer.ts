import type { Cell } from "../ui/map/MapView";

/** 押したボタンと修飾キー。 */
export interface Gesture {
  /** 0 = 左、2 = 右。 */
  readonly button: number;
  readonly ctrl: boolean;
  readonly shift: boolean;
  /** Alt（Phase3 #233 の 2 マスの入れ替え）。 */
  readonly alt: boolean;
}

/** マス目の上でのマウス操作の受け手。`move` はドラッグ中にマスが変わったときだけ呼ぶ。 */
export interface CellPointerHandlers {
  down(cell: Cell, gesture: Gesture): void;
  move?(cell: Cell, gesture: Gesture): void;
  /** 離したとき。マス目の外で離したら cell は null。 */
  up?(cell: Cell | null, gesture: Gesture): void;
  /** 押していないときのマウス移動（ステータスバー用）。マス目の外なら null。 */
  hover?(cell: Cell | null): void;
}

/**
 * 要素の上のマウス操作をマス目の操作に変える。ドラッグ中は要素の外に出ても追い、
 * 同じマスの上での細かい動きは無視する（AdvanceMap と同じく、通ったマスだけに反応する。線の補間はしない）。
 */
export function attachCellPointer(
  element: HTMLElement,
  cellAt: (e: MouseEvent) => Cell | null,
  handlers: CellPointerHandlers,
): void {
  let gesture: Gesture | null = null;
  let last: Cell | null = null;

  element.addEventListener("pointerdown", (e) => {
    if (gesture || (e.button !== 0 && e.button !== 2)) return;
    const cell = cellAt(e);
    if (!cell) return;
    e.preventDefault();
    // 自動操作で作ったイベントは捕まえられないことがあるので、失敗しても続ける。
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      /* 何もしない */
    }
    gesture = { button: e.button, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey };
    last = cell;
    handlers.down(cell, gesture);
  });
  element.addEventListener("pointermove", (e) => {
    const cell = cellAt(e);
    if (!gesture) {
      handlers.hover?.(cell);
      return;
    }
    handlers.hover?.(cell);
    if (!cell || (last && last.x === cell.x && last.y === cell.y)) return;
    last = cell;
    handlers.move?.(cell, gesture);
  });
  const finish = (e: PointerEvent): void => {
    if (!gesture || e.button !== gesture.button) return;
    const g = gesture;
    gesture = null;
    last = null;
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    handlers.up?.(cellAt(e), g);
  };
  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", finish);
  element.addEventListener("pointerleave", () => {
    if (!gesture) handlers.hover?.(null);
  });
}
