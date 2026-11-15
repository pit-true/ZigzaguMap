import { BRUSH_SIZES } from "@zigzagumap/core";
import type { AutoPenService } from "../../app/AutoPenService";
import type { EditorState } from "../../app/EditorState";
import { jaPen } from "../../i18n/ja.pen";
import "../../styles/autopen.css";

/**
 * マップタブの右の欄のオートペン（#310）: 「オートペン (P)」「筆」（1・2・3・5）「移動許可も付ける」と、選んでいるブロックで描くパーツ。
 * どれも個人設定（`autoPen`・`autoPenSize`・`autoPenMovement`）に入る。
 */
export class AutoPenPanel {
  readonly element: HTMLElement;
  private readonly enable: HTMLInputElement;
  private readonly size: HTMLSelectElement;
  private readonly movement: HTMLInputElement;
  private readonly partLabel: HTMLElement;

  constructor(
    private readonly state: EditorState,
    private readonly service: AutoPenService,
  ) {
    this.element = document.createElement("div");
    this.element.className = "autopen-panel";

    const enableRow = document.createElement("label");
    enableRow.title = jaPen.autoPenHint;
    this.enable = document.createElement("input");
    this.enable.type = "checkbox";
    this.enable.dataset["autoId"] = "autopen.enable";
    this.enable.addEventListener("change", () => this.setActive(this.enable.checked));
    enableRow.append(this.enable, document.createTextNode(jaPen.autoPen));

    const sizeRow = document.createElement("label");
    sizeRow.title = jaPen.autoPenSizeHint;
    this.size = document.createElement("select");
    this.size.dataset["autoId"] = "autopen.size";
    for (const n of BRUSH_SIZES) {
      const o = document.createElement("option");
      o.value = String(n);
      o.textContent = String(n);
      this.size.append(o);
    }
    this.size.addEventListener("change", () => {
      state.settings.update({ autoPenSize: Number(this.size.value) });
      state.emit("view");
    });
    sizeRow.append(document.createTextNode(jaPen.autoPenSize), this.size);

    const moveRow = document.createElement("label");
    moveRow.title = jaPen.autoPenMovementHint;
    this.movement = document.createElement("input");
    this.movement.type = "checkbox";
    this.movement.dataset["autoId"] = "autopen.movement";
    this.movement.addEventListener("change", () => state.settings.update({ autoPenMovement: this.movement.checked }));
    moveRow.append(this.movement, document.createTextNode(jaPen.autoPenMovement));

    this.partLabel = document.createElement("div");
    this.partLabel.className = "autopen-part";
    this.element.append(enableRow, sizeRow, moveRow, this.partLabel);

    for (const topic of ["view", "selection", "map", "session"] as const) state.on(topic, () => this.sync());
    service.onChange(() => this.sync());
    this.sync();
  }

  /** オン・オフを変える（P キーと同じ）。 */
  setActive(on: boolean): void {
    this.state.settings.update({ autoPen: on });
    this.state.emit("view");
    this.state.setStatus(on ? jaPen.autoPenOn : jaPen.autoPenOff);
    if (on) this.suggest();
  }

  /** パーツが無いタイルセットなら、マップから候補を作って使う（Q7 の推奨。保存はしない）。 */
  suggest(): void {
    const set = this.service.set;
    if (!set || set.parts.length > 0 || set.candidates) return;
    this.state.setStatus(jaPen.autoPenAnalyzing);
    void this.service.analyze().then((parts) => this.state.setStatus(jaPen.autoPenAnalyzed(parts.length)));
  }

  private sync(): void {
    const s = this.state.settings.data;
    this.enable.checked = s.autoPen;
    this.size.value = String(s.autoPenSize);
    this.movement.checked = s.autoPenMovement;
    this.size.disabled = !s.autoPen;
    this.movement.disabled = !s.autoPen;
    const sel = this.state.selection;
    const part = s.autoPen && sel.width === 1 && sel.height === 1 ? (this.service.set?.index.partOf(sel.blocks[0] ?? 0) ?? null) : null;
    this.partLabel.textContent = part ? `${part.name}（${jaPen.kinds[part.kind] ?? part.kind}）` : "";
    this.partLabel.title = this.partLabel.textContent;
    this.partLabel.hidden = !part;
  }
}
