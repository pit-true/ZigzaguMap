import type { EditorState } from "../../app/EditorState";
import { matchesKey } from "../../app/keymap";
import { MOVEMENT_COLORS } from "../../app/data/movementColors";
import { jaPaint } from "../../i18n/ja.paint";
import type { Cell } from "../../ui/map/MapView";
import { rectOf, type CellRect } from "../paintPlans";
import type { PreviewCanvas } from "../PreviewCanvas";
import { strokeCellRect } from "../previewDraw";

/**
 * 移動エリアタブの Ctrl＋左ドラッグの矩形塗り（Phase3 #233）。ドラッグ中は選択中の値の色と赤い枠で下見し、離したら `onFill` で
 * 1 回に書く。Esc（`drag.cancel`）で取りやめる。マップタブの矩形塗り（`BlockDragTools`）と同じ動きで、書くのは移動許可だけ。
 * Phase5 の仕上げ（#406）で MovementPainter から分けた。
 */
export class MovementRectTool {
  private drag: { anchor: Cell; last: Cell; cancelled: boolean } | null = null;

  constructor(
    private readonly state: EditorState,
    /** 下見（Ctrl を押している間は重ね描きの Canvas が隠れるため、別に置く）。 */
    private readonly preview: PreviewCanvas,
    /** 離したときに矩形を書く。 */
    private readonly onFill: (rect: CellRect) => void,
    /** 下見を消したあと、移動許可の重ね描きを描き直す。 */
    private readonly redrawLayer: () => void,
  ) {
    document.addEventListener("keydown", (e) => {
      if (!matchesKey("drag.cancel", e) || !this.drag || this.drag.cancelled) return;
      e.preventDefault();
      this.drag.cancelled = true;
      this.clearPreview();
      this.state.setStatus(jaPaint.dragCancelled);
    });
  }

  /** ドラッグの途中か。 */
  get active(): boolean {
    return this.drag !== null;
  }

  begin(cell: Cell): void {
    this.drag = { anchor: cell, last: cell, cancelled: false };
    this.showPreview(rectOf(cell, cell));
  }

  move(cell: Cell): void {
    const d = this.drag;
    if (!d || d.cancelled) return;
    d.last = cell;
    this.showPreview(rectOf(d.anchor, cell));
  }

  /** 離したとき。ドラッグの途中でなければ false。 */
  end(cell: Cell | null): boolean {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    this.clearPreview();
    if (!d.cancelled) this.onFill(rectOf(d.anchor, cell ?? d.last));
    return true;
  }

  /** 矩形の下見（選択中の値の色を薄く塗り、赤い枠を引く）。 */
  private showPreview(r: CellRect): void {
    const p = this.preview.begin();
    p.c.save();
    p.c.globalAlpha = 0.5;
    p.c.fillStyle = MOVEMENT_COLORS[this.state.movement] ?? "#000";
    p.c.fillRect(p.ox + r.x * p.size, p.oy + r.y * p.size, r.width * p.size, r.height * p.size);
    p.c.restore();
    strokeCellRect(p, r, "#ff0000");
  }

  private clearPreview(): void {
    this.preview.end();
    this.redrawLayer();
  }
}
