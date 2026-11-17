import type { EditorState } from "../../app/EditorState";
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, toBrushShape } from "@zigzagumap/core";
import { PAINT_TOOLS, brushSetting, currentTool, setBrush, setPaintTool, setSmartPath, type PaintTool } from "../../app/paintTool";
import { jaTools } from "../../i18n/ja.tools";
import "../../styles/tools.css";

const LABELS: Readonly<Record<PaintTool, string>> = { pencil: jaTools.pencil, fill: jaTools.fill, shift: jaTools.shift, select: jaTools.select };
const HINTS: Readonly<Record<PaintTool, string>> = { pencil: jaTools.pencilHint, fill: jaTools.fillHint, shift: jaTools.shiftHint, select: jaTools.selectHint };

/**
 * 道具の帯（Phase5 #388。Q1 の推奨）。マップタブと移動エリアタブの右の欄の上に置く（AdvanceMap と比べるマップ表示の領域にはかけない）。
 * 鉛筆・塗り・シフト・選択のボタン（N・B・S・M でも切り替え。選択は Phase7 #516）と、マップタブだけスマートパスのチェック（#389）。
 * 部品の ID は `tools.<タブ>.<道具>`（例: `tools.map.fill`）と `tools.smartPath`。
 * Phase7 #515: 鉛筆のブラシの大きさ（1〜9）と形の欄（`tools.<タブ>.brushSize`・`tools.<タブ>.brushShape`）。両方のタブで同じ値。
 */
export class ToolStrip {
  readonly element: HTMLElement;
  private readonly buttons = new Map<PaintTool, HTMLButtonElement>();
  private readonly smart: HTMLInputElement | null = null;
  private readonly brushSize: HTMLSelectElement;
  private readonly brushShape: HTMLSelectElement;

  constructor(
    private readonly state: EditorState,
    tab: "map" | "movement",
  ) {
    this.element = document.createElement("div");
    this.element.className = `tool-strip tool-strip-${tab}`;
    this.element.setAttribute("role", "toolbar");
    this.element.setAttribute("aria-label", jaTools.stripLabel);
    const row = document.createElement("div");
    row.className = "tool-strip-buttons";
    for (const { id } of PAINT_TOOLS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tool-button";
      b.textContent = LABELS[id];
      b.title = HINTS[id];
      b.dataset["autoId"] = `tools.${tab}.${id}`;
      // 押してもフォーカスを取らない（マップの上のキー操作を続けられるように）
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        setPaintTool(state, id);
        state.setStatus(jaTools.toolChanged(jaTools.toolNames[id] ?? id));
      });
      this.buttons.set(id, b);
      row.append(b);
    }
    this.element.append(row);
    // ブラシの大きさと形（#515）
    const brush = document.createElement("div");
    brush.className = "tool-strip-brush";
    this.brushSize = document.createElement("select");
    this.brushSize.title = jaTools.brushSizeHint;
    this.brushSize.dataset["autoId"] = `tools.${tab}.brushSize`;
    for (let n = MIN_BRUSH_SIZE; n <= MAX_BRUSH_SIZE; n++) this.brushSize.append(new Option(jaTools.brushSizeOption(n), String(n)));
    this.brushShape = document.createElement("select");
    this.brushShape.title = jaTools.brushShapeHint;
    this.brushShape.dataset["autoId"] = `tools.${tab}.brushShape`;
    for (const id of ["square", "circle"]) this.brushShape.append(new Option(jaTools.brushShapes[id] ?? id, id));
    const changed = (): void => {
      setBrush(state, { size: Number(this.brushSize.value), shape: toBrushShape(this.brushShape.value) });
      const b = brushSetting(state);
      state.setStatus(jaTools.brushChanged(b.size, b.shape));
    };
    this.brushSize.addEventListener("change", changed);
    this.brushShape.addEventListener("change", changed);
    if (tab === "map") {
      const label = document.createElement("span");
      label.textContent = jaTools.brushLabel;
      label.title = jaTools.brushSizeHint;
      brush.append(label);
    }
    brush.append(this.brushSize, this.brushShape);
    this.element.append(brush);
    if (tab === "map") {
      const label = document.createElement("label");
      label.className = "tool-strip-smart";
      label.title = jaTools.smartPathHint;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset["autoId"] = "tools.smartPath";
      box.addEventListener("change", () => {
        setSmartPath(state, box.checked);
        state.setStatus(box.checked ? jaTools.smartPathOn : jaTools.smartPathOff);
      });
      label.append(box, document.createTextNode(jaTools.smartPath));
      this.element.append(label);
      this.smart = box;
    }
    for (const topic of ["tool", "selection"] as const) state.on(topic, () => this.sync());
    this.sync();
  }

  private sync(): void {
    const tool = currentTool(this.state);
    for (const [id, b] of this.buttons) {
      const on = id === tool;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    const b = brushSetting(this.state);
    this.brushSize.value = String(b.size);
    this.brushShape.value = b.shape;
    if (this.smart) {
      const s = this.state.selection;
      this.smart.checked = this.state.settings.data.smartPath;
      // 3×3 でないときは灰色の字で、使えないことを示す（チェックは変えられる）
      this.smart.parentElement!.classList.toggle("unavailable", !(s.width === 3 && s.height === 3));
    }
  }
}
