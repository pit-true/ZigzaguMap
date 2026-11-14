import { PaintMovementCommand } from "@zigzagumap/core";
import type { EditorState } from "../app/EditorState";
import { MOVEMENT_COLORS } from "../app/data/movementColors";
import { ja } from "../i18n/ja";
import { jaPaint } from "../i18n/ja.paint";
import type { Cell, MapView } from "../ui/map/MapView";
import { attachCellPointer } from "./CellPointer";
import { rectOf, type CellRect } from "./paintPlans";

/** 移動許可の説明（[GehDaten]。無いものは ???）。 */
export function movementName(value: number): string {
  return ja.movementNames[value] ?? ja.movementUnknown;
}

/**
 * 移動エリアタブのマウス操作。
 * - 左クリック・左ドラッグ: 選択中の値を書く（ドラッグは 1 回の操作にまとめる。ブロック番号は変えない）。
 * - Ctrl＋左ドラッグ: 矩形に選択中の値を書く（Phase3 #233。ドラッグ中は枠で下見し、離したら 1 回で書く。Esc で取りやめ）。
 * - 右クリック・右ドラッグ: 離したマスの値を拾う。ほかの修飾キーは無視する。
 */
export class MovementPainter {
  private rect: { anchor: Cell; last: Cell; cancelled: boolean } | null = null;
  /** 矩形の下見の Canvas（ドラッグの間だけ置く。Ctrl を押している間は重ね描きの Canvas が隠れるため、別に置く）。 */
  private previewCanvas: HTMLCanvasElement | null = null;

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly onPicked: () => void,
    /** 下見を消したあと、移動許可の重ね描きを描き直す。 */
    private readonly redrawLayer: () => void = () => undefined,
  ) {
    attachCellPointer(view.stage, (e) => view.cellAt(e), {
      down: (cell, g) => {
        if (g.button === 0 && g.ctrl) {
          this.rect = { anchor: cell, last: cell, cancelled: false };
          this.preview(rectOf(cell, cell));
        } else if (g.button === 0) this.paint(cell, false);
      },
      move: (cell, g) => {
        const r = this.rect;
        if (r) {
          if (r.cancelled) return;
          r.last = cell;
          this.preview(rectOf(r.anchor, cell));
        } else if (g.button === 0) this.paint(cell, true);
      },
      up: (cell, g) => {
        const r = this.rect;
        if (r) {
          this.rect = null;
          this.clearPreview();
          if (!r.cancelled) this.fill(rectOf(r.anchor, cell ?? r.last));
          return;
        }
        if (g.button === 2 && cell) this.pick(cell);
      },
      hover: (cell) => this.hover(cell),
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.rect || this.rect.cancelled) return;
      e.preventDefault();
      this.rect.cancelled = true;
      this.clearPreview();
      this.state.setStatus(jaPaint.dragCancelled);
    });
  }

  private paint(cell: Cell, merge: boolean): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const cells = [{ x: cell.x, y: cell.y, movement: this.state.movement }];
    session.bus.execute(new PaintMovementCommand({ bank: map.id.bank, map: map.id.map, cells }), { merge });
  }

  /** 矩形に選択中の値を書く（1 回の操作）。 */
  private fill(r: CellRect): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const cells: { x: number; y: number; movement: number }[] = [];
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) if (map.doc.grid.inBounds(x, y)) cells.push({ x, y, movement: this.state.movement });
    }
    if (cells.length > 0) session.bus.execute(new PaintMovementCommand({ bank: map.id.bank, map: map.id.map, cells }));
  }

  /** 矩形の下見（選択中の値の色を薄く塗り、赤い枠を引く）。 */
  private preview(r: CellRect): void {
    const layer = this.view.layer;
    let canvas = this.previewCanvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "map-preview";
      this.view.stage.append(canvas);
      this.previewCanvas = canvas;
    }
    canvas.width = layer.width;
    canvas.height = layer.height;
    canvas.style.left = layer.style.left;
    canvas.style.top = layer.style.top;
    canvas.style.width = layer.style.width;
    canvas.style.height = layer.style.height;
    canvas.style.pointerEvents = "none";
    const c = canvas.getContext("2d")!;
    const size = this.view.cellSize;
    c.save();
    c.globalAlpha = 0.5;
    c.fillStyle = MOVEMENT_COLORS[this.state.movement] ?? "#000";
    c.fillRect(r.x * size, r.y * size, r.width * size, r.height * size);
    c.restore();
    c.strokeStyle = "#ff0000";
    c.lineWidth = 1;
    c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, r.width * size - 1, r.height * size - 1);
  }

  private clearPreview(): void {
    this.previewCanvas?.remove();
    this.previewCanvas = null;
    this.redrawLayer();
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
