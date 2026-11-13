import { PaintMovementCommand } from "@zigzagumap/core";
import type { EditorState } from "../app/EditorState";
import { ja } from "../i18n/ja";
import type { Cell, MapView } from "../ui/map/MapView";
import { attachCellPointer } from "./CellPointer";

/** 移動許可の説明（[GehDaten]。無いものは ???）。 */
export function movementName(value: number): string {
  return ja.movementNames[value] ?? ja.movementUnknown;
}

/**
 * 移動エリアタブのマウス操作。
 * - 左クリック・左ドラッグ: 選択中の値を書く（ドラッグは 1 回の操作にまとめる。ブロック番号は変えない）。
 * - 右クリック・右ドラッグ: 離したマスの値を拾う。修飾キーは無視する。
 */
export class MovementPainter {
  constructor(
    view: MapView,
    private readonly state: EditorState,
    private readonly onPicked: () => void,
  ) {
    attachCellPointer(view.stage, (e) => view.cellAt(e), {
      down: (cell, g) => {
        if (g.button === 0) this.paint(cell, false);
      },
      move: (cell, g) => {
        if (g.button === 0) this.paint(cell, true);
      },
      up: (cell, g) => {
        if (g.button === 2 && cell) this.pick(cell);
      },
      hover: (cell) => this.hover(cell),
    });
  }

  private paint(cell: Cell, merge: boolean): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const cells = [{ x: cell.x, y: cell.y, movement: this.state.movement }];
    session.bus.execute(new PaintMovementCommand({ bank: map.id.bank, map: map.id.map, cells }), { merge });
  }

  private pick(cell: Cell): void {
    const map = this.state.map;
    if (!map) return;
    this.state.selectMovement(map.doc.grid.getMovement(cell.x, cell.y));
    this.onPicked();
  }

  private hover(cell: Cell | null): void {
    const map = this.state.map;
    if (!cell || !map) return;
    this.state.setStatus(ja.statusMapCell(cell.x, cell.y, movementName(map.doc.grid.getMovement(cell.x, cell.y))));
  }
}
