import { ja } from "../../i18n/ja";
import { jaTools } from "../../i18n/ja.tools";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";
import { DEFAULT_GRID_STYLE, GRID_LINES, MAX_GRID_STEP, normalizeGridStyle, type GridLine, type GridStyle } from "../map/gridStyle";
import "../../styles/tools.css";

/**
 * 表示 > グリッドの設定… の窓（Phase5 #391）。線の間（幅・高さ。マス）、ずらし（マス）、色、線の形（実線・破線・点）を決める。
 * 入れている間もマップの上のグリッドに当てて見せ（`preview`）、OK で個人設定に残す。キャンセルで元に戻す。「既定に戻す」は今までの見た目。
 * グリッドを出していないときは、OK で出す（Ctrl+G の切り替えはそのまま）。
 * 部品の ID: `grid.width`・`grid.height`・`grid.offsetX`・`grid.offsetY`・`grid.color`・`grid.line`（`solid` / `dashed` / `dotted`）・`grid.reset`。
 */
export function openGridSettings(initial: GridStyle, preview: (style: GridStyle) => void, commit: (style: GridStyle) => void): void {
  const t = jaTools;
  let done = false;
  const cancel = (): void => {
    if (done) return;
    done = true;
    preview(initial);
    frame.remove();
  };
  const frame = createDialog({ title: t.gridTitle, width: 300, className: "grid-settings", onClose: cancel });
  const num = (id: string, value: number, min: number, max: number): HTMLInputElement => {
    const el = document.createElement("input");
    el.type = "number";
    el.min = String(min);
    el.max = String(max);
    el.step = "1";
    el.value = String(value);
    el.dataset["autoId"] = id;
    el.className = "resize-number";
    return el;
  };
  const width = num("grid.width", initial.width, 1, MAX_GRID_STEP);
  const height = num("grid.height", initial.height, 1, MAX_GRID_STEP);
  const offsetX = num("grid.offsetX", initial.offsetX, 0, MAX_GRID_STEP - 1);
  const offsetY = num("grid.offsetY", initial.offsetY, 0, MAX_GRID_STEP - 1);
  const color = document.createElement("input");
  color.type = "color";
  color.value = initial.color;
  color.dataset["autoId"] = "grid.color";
  const line = document.createElement("select");
  line.dataset["autoId"] = "grid.line";
  for (const l of GRID_LINES) {
    const o = document.createElement("option");
    o.value = l;
    o.textContent = t.gridLines[l] ?? l;
    line.append(o);
  }
  line.value = initial.line;
  const grid = document.createElement("div");
  grid.className = "resize-grid";
  const cell = (label: string, input: HTMLElement): HTMLElement[] => {
    const l = document.createElement("span");
    l.textContent = label;
    return [l, input];
  };
  grid.append(
    ...cell(t.gridWidth, width),
    ...cell(t.gridHeight, height),
    ...cell(t.gridOffsetX, offsetX),
    ...cell(t.gridOffsetY, offsetY),
    ...cell(t.gridColor, color),
    ...cell(t.gridLine, line),
  );
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = t.gridNote;
  const current = (): GridStyle =>
    normalizeGridStyle({
      width: Number(width.value),
      height: Number(height.value),
      offsetX: Number(offsetX.value),
      offsetY: Number(offsetY.value),
      color: color.value,
      line: line.value as GridLine,
    });
  const show = (): void => preview(current());
  for (const el of [width, height, offsetX, offsetY, color, line]) {
    el.addEventListener("input", show);
    el.addEventListener("change", show);
  }
  const reset = (): void => {
    width.value = String(DEFAULT_GRID_STYLE.width);
    height.value = String(DEFAULT_GRID_STYLE.height);
    offsetX.value = String(DEFAULT_GRID_STYLE.offsetX);
    offsetY.value = String(DEFAULT_GRID_STYLE.offsetY);
    color.value = DEFAULT_GRID_STYLE.color;
    line.value = DEFAULT_GRID_STYLE.line;
    show();
  };
  const ok = (): void => {
    if (done) return;
    done = true;
    commit(current());
    frame.remove();
  };
  const resetButton = dialogButton(t.gridReset, reset);
  resetButton.dataset["autoId"] = "grid.reset";
  resetButton.classList.add("wide");
  const buttons = document.createElement("div");
  buttons.className = "dialog-buttons";
  buttons.append(resetButton, dialogButton(ja.ok, ok), dialogButton(ja.cancel, cancel));
  frame.body.append(grid, note, buttons);
  handleDialogKeys(frame, cancel, (e) => {
    if (e.key === "Enter") ok();
  });
  frame.register({
    title: t.gridTitle,
    text: t.gridNote,
    ...pressable([
      { label: ja.ok, aliases: ["ok"], run: ok },
      { label: ja.cancel, aliases: ["cancel"], run: cancel },
      { label: t.gridReset, aliases: ["reset"], run: reset },
    ]),
  });
  show();
  width.focus();
}
