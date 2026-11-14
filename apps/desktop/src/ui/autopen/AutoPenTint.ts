import type { AutoPenService } from "../../app/AutoPenService";
import type { EditorState } from "../../app/EditorState";
import type { BlockPaletteView } from "../map/BlockPaletteView";
import type { PaletteGeometry } from "../map/paletteLayers";

/** 色（薄い紅色）。 */
const TINT = "rgba(255, 64, 160, 0.28)";

/**
 * 自動ペンで描けるブロック（パーツに入っているブロック）に、ブロックパレットで薄い色を重ねる（#310）。
 * 表示 > 自動ペンで描けるブロックに色を付ける（設定 `autoPenTint`、既定オン）で、自動ペンがオンのときだけ描く。
 */
export class AutoPenTint {
  constructor(
    private readonly state: EditorState,
    private readonly service: AutoPenService,
    palette: BlockPaletteView,
  ) {
    palette.addLayer("overlay", (c, g) => this.draw(c, g));
    const repaint = () => palette.repaintOverlay();
    state.on("view", repaint);
    service.onChange(repaint);
  }

  /** 色を重ねているか。 */
  get shown(): boolean {
    return this.state.settings.data.autoPen && this.state.settings.data.autoPenTint && (this.service.set?.index.size ?? 0) > 0;
  }

  /** 色を重ねるブロック（自動操作用）。 */
  blocks(): number[] {
    return this.shown ? [...this.service.set!.index.blocks()].sort((a, b) => a - b) : [];
  }

  private draw(c: CanvasRenderingContext2D, g: PaletteGeometry): void {
    if (!this.shown) return;
    c.fillStyle = TINT;
    for (const b of this.service.set!.index.blocks()) {
      if (b >= g.count) continue;
      const p = g.cellOf(b);
      c.fillRect(p.col * g.size, p.row * g.size, g.size, g.size);
    }
  }
}
