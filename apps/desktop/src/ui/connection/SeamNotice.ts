import type { EditorState } from "../../app/EditorState";
import type { SeamWarnings } from "../../app/neighbors/SeamWarnings";
import { jaSeams as t } from "../../i18n/ja.seams";
import { messageBox } from "../MessageBox";
import type { NeighborLayer } from "../map/NeighborLayer";

/** 崩れるマスの枠の色。 */
const MARK_COLOR = "#ff2020";

/**
 * 接続の境目の注意（#305）の画面側。ステータスバーに「注意: 接続 N か所」を出し（押すと一覧）、
 * マップタブの隣の帯に崩れるマスの赤い枠を描く。
 */
export class SeamNotice {
  /** ステータスバーに置く部品（注意が無ければ隠す）。 */
  readonly element: HTMLButtonElement;

  constructor(
    private readonly state: EditorState,
    private readonly warnings: SeamWarnings,
    layer: NeighborLayer,
  ) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "status-panel status-warn";
    this.element.dataset["autoId"] = "status.seams";
    this.element.title = t.statusHint;
    this.element.hidden = true;
    this.element.addEventListener("click", () => void this.showList());
    layer.addDecorator((c, bandAt, size) => this.drawMarks(c, bandAt, size));
    warnings.onChange(() => {
      this.render();
      layer.draw();
    });
    state.on("map", () => this.render());
  }

  private render(): void {
    const r = this.warnings.current;
    const id = this.state.map?.id;
    const shown = !!id && r.map?.bank === id.bank && r.map.map === id.map ? r.issues : [];
    this.element.hidden = shown.length === 0;
    this.element.textContent = t.status(shown.length);
  }

  /** 一覧（方向・相手のマップ・マスの数）。 */
  async showList(): Promise<void> {
    const issues = this.warnings.current.issues;
    if (issues.length === 0) return;
    const catalog = this.state.session?.catalog;
    const rows = issues.map((i) => t.row(t.sides[i.side] ?? i.side, i.id.bank, i.id.map, catalog?.get(i.id)?.name ?? null, i.cells.length));
    await messageBox(t.title, [t.intro, "", ...rows].join("\n"), "warning");
  }

  /** 帯（主マップの座標で `bandAt` の範囲）の上に、崩れるマスの枠を描く。 */
  private drawMarks(c: CanvasRenderingContext2D, bandAt: { x: number; y: number; width: number; height: number }, size: number): void {
    const r = this.warnings.current;
    const id = this.state.map?.id;
    if (!id || r.map?.bank !== id.bank || r.map.map !== id.map) return;
    c.save();
    c.strokeStyle = MARK_COLOR;
    c.lineWidth = Math.max(1, Math.round(size / 16));
    const inset = c.lineWidth / 2;
    for (const issue of r.issues) {
      for (const p of issue.cells) {
        const x = p.x - bandAt.x;
        const y = p.y - bandAt.y;
        if (x < 0 || y < 0 || x >= bandAt.width || y >= bandAt.height) continue;
        c.strokeRect(x * size + inset, y * size + inset, size - c.lineWidth, size - c.lineWidth);
      }
    }
    c.restore();
  }
}
