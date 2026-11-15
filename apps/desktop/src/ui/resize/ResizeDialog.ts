import { MIN_EDGE_RESIZE, maxMapHeight, type BoxResize, type EdgeFill } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { jaTools } from "../../i18n/ja.tools";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../Dialog";
import "../../styles/tools.css";

/** 広げた所の埋め方（Q6 の推奨: 既定は今と同じ端の写し）。 */
export type ResizeFillKind = "edge" | "border" | "selection";

/** 窓で決めたこと。 */
export interface ResizePlan {
  readonly box: BoxResize;
  readonly fill: ResizeFillKind;
}

/** 決めた大きさと位置（左に足す `x`・上に足す `y`）から 4 辺の変え方を作る。 */
export function planBox(width: number, height: number, newWidth: number, newHeight: number, x: number, y: number): BoxResize {
  return { left: x, right: newWidth - width - x, up: y, down: newHeight - height - y };
}

/** 埋め方から、ResizeMapEdgeCommand に渡す柄を作る（端の写しなら undefined）。 */
export function fillPattern(state: EditorState, kind: ResizeFillKind): EdgeFill | undefined {
  const map = state.map;
  if (!map || kind === "edge") return undefined;
  if (kind === "border") {
    const b = map.doc.border;
    return { width: b.width, height: b.height, cells: [...b.cells] };
  }
  const s = state.selection;
  // 選んでいるブロック（スタンプは柄）。穴のマスと 3 層の次の番号は柄の最初のブロックにする。移動許可は拾ったものがあればそれ、無ければ 0
  const first = s.blocks[0] ?? 0;
  const triple = map.tiles.triple;
  const cells = s.blocks.map((b, i) => {
    const block = s.holes?.[i] || triple.isTripleChild(b) ? first : b;
    return (block & 0x3ff) | ((s.movements?.[i] ?? 0) << 10);
  });
  return { width: s.width, height: s.height, cells };
}

/** 図の大きさ（px）。 */
const VIEW_W = 300;
const VIEW_H = 220;

/**
 * 対話式リサイズの窓（Phase5 #390。Q6 の推奨）。幅・高さの数値と、新しい枠の中で今のマップを置く位置（図のドラッグか、
 * 「左に足す」「上に足す」の数値）と、広げた所を埋めるブロック（端の写し・境界ブロック・選んでいるブロック）を決める。
 * OK で 4 辺分の ResizeMapEdgeCommand を 1 回の操作にして実行する（左・上へずれたときのイベント・接続・フライトポジション・
 * ラベルの補正は辺のつまみと同じ）。大きさの上限と下限は辺のつまみと同じ。
 * 部品の ID: `resize.width`・`resize.height`・`resize.left`・`resize.top`・`resize.fill`（`edge` / `border` / `selection`）・
 * `resize.view`（図）・`resize.info`（変わる量か、入力の問題）。ボタンは OK・キャンセル。
 */
export function openResizeDialog(state: EditorState, apply: (plan: ResizePlan) => Promise<boolean>): void {
  const map = state.map;
  if (!map) return;
  const w0 = map.doc.width;
  const h0 = map.doc.height;
  const t = jaTools;
  const frame = createDialog({ title: t.resizeTitle, width: 340, className: "resize-dialog", onClose: () => frame.remove() });

  const num = (id: string, value: number): HTMLInputElement => {
    const el = document.createElement("input");
    el.type = "number";
    el.step = "1";
    el.value = String(value);
    el.dataset["autoId"] = id;
    el.className = "resize-number";
    return el;
  };
  const width = num("resize.width", w0);
  const height = num("resize.height", h0);
  const left = num("resize.left", 0);
  const top = num("resize.top", 0);
  width.min = String(MIN_EDGE_RESIZE);
  height.min = String(MIN_EDGE_RESIZE);
  const fill = document.createElement("select");
  fill.dataset["autoId"] = "resize.fill";
  for (const [value, label] of [
    ["edge", t.resizeFillEdge],
    ["border", t.resizeFillBorder],
    ["selection", t.resizeFillSelection],
  ] as const) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    fill.append(o);
  }
  const grid = document.createElement("div");
  grid.className = "resize-grid";
  const cell = (label: string, input: HTMLElement): HTMLElement[] => {
    const l = document.createElement("span");
    l.textContent = label;
    return [l, input];
  };
  grid.append(...cell(t.resizeWidth, width), ...cell(t.resizeHeight, height), ...cell(t.resizeLeft, left), ...cell(t.resizeTop, top));
  const fillRow = document.createElement("label");
  fillRow.className = "resize-fill";
  fillRow.append(document.createTextNode(t.resizeFill), fill);
  const now = document.createElement("p");
  now.className = "note";
  now.textContent = t.resizeNow(w0, h0);
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = t.resizePlaceNote;
  const view = document.createElement("canvas");
  view.className = "resize-view";
  view.width = VIEW_W;
  view.height = VIEW_H;
  view.dataset["autoId"] = "resize.view";
  const info = document.createElement("p");
  info.className = "resize-info";
  info.dataset["autoId"] = "resize.info";

  // 今のマップの絵（等倍を 1 枚だけ。窓を閉じれば捨てる）
  const thumb = document.createElement("canvas");
  const image = state.mapImage;
  if (image) {
    thumb.width = image.imageData.width;
    thumb.height = image.imageData.height;
    thumb.getContext("2d")!.putImageData(image.imageData, 0, 0);
  }

  const values = (): { w: number; h: number; x: number; y: number } => ({
    w: Math.round(Number(width.value) || 0),
    h: Math.round(Number(height.value) || 0),
    x: Math.round(Number(left.value) || 0),
    y: Math.round(Number(top.value) || 0),
  });
  /** 入力の問題（無ければ null）。 */
  const problem = (): string | null => {
    const v = values();
    if (v.w < MIN_EDGE_RESIZE || v.h < MIN_EDGE_RESIZE) return t.resizeTooSmall(MIN_EDGE_RESIZE);
    if (v.h > maxMapHeight(v.w)) return t.resizeTooLarge(v.w, Math.max(0, maxMapHeight(v.w)));
    return null;
  };
  let scale = 1;
  const draw = (): void => {
    const v = values();
    const c = view.getContext("2d")!;
    c.clearRect(0, 0, VIEW_W, VIEW_H);
    // 新しい枠と今のマップの両方が入る範囲
    const minX = Math.min(0, v.x);
    const minY = Math.min(0, v.y);
    const maxX = Math.max(v.w, v.x + w0);
    const maxY = Math.max(v.h, v.y + h0);
    scale = Math.min((VIEW_W - 8) / Math.max(1, maxX - minX), (VIEW_H - 8) / Math.max(1, maxY - minY));
    const ox = 4 - minX * scale;
    const oy = 4 - minY * scale;
    c.imageSmoothingEnabled = false;
    c.globalAlpha = 0.85;
    if (image) c.drawImage(thumb, ox + v.x * scale, oy + v.y * scale, w0 * scale, h0 * scale);
    c.globalAlpha = 1;
    c.strokeStyle = "#ff0000";
    c.lineWidth = 2;
    c.strokeRect(ox, oy, v.w * scale, v.h * scale);
    const box = planBox(w0, h0, v.w, v.h, v.x, v.y);
    const p = problem();
    info.textContent = p ?? `${t.resizeSummary(box.left, box.right, box.up, box.down)}　${t.resizeLimit(v.w, Math.max(0, maxMapHeight(v.w)))}`;
    info.classList.toggle("error", p !== null);
  };
  for (const el of [width, height, left, top]) el.addEventListener("input", draw);

  // 図のマップをドラッグして位置を決める
  let drag: { sx: number; sy: number; x: number; y: number } | null = null;
  view.addEventListener("pointerdown", (e) => {
    const v = values();
    drag = { sx: e.clientX, sy: e.clientY, x: v.x, y: v.y };
    try {
      view.setPointerCapture(e.pointerId);
    } catch {
      /* 自動操作のイベントは捕まえられないことがある */
    }
  });
  view.addEventListener("pointermove", (e) => {
    if (!drag) return;
    left.value = String(drag.x + Math.round((e.clientX - drag.sx) / scale));
    top.value = String(drag.y + Math.round((e.clientY - drag.sy) / scale));
    draw();
  });
  const endDrag = (): void => {
    drag = null;
  };
  view.addEventListener("pointerup", endDrag);
  view.addEventListener("pointercancel", endDrag);

  let busy = false;
  const ok = (): void => {
    if (busy) return;
    if (problem()) return draw();
    const v = values();
    busy = true;
    void apply({ box: planBox(w0, h0, v.w, v.h, v.x, v.y), fill: fill.value as ResizeFillKind }).then((done) => {
      busy = false;
      if (done) frame.remove();
    });
  };
  const buttons = dialogButtonRow(dialogButton(ja.ok, ok), dialogButton(ja.cancel, () => frame.remove()));
  frame.body.append(now, grid, fillRow, note, view, info, buttons);
  handleDialogKeys(
    frame,
    () => frame.remove(),
    (e) => {
      if (e.key === "Enter") ok();
    },
  );
  frame.register({
    title: t.resizeTitle,
    text: t.resizeNow(w0, h0),
    ...pressable([
      { label: ja.ok, aliases: ["ok"], run: ok },
      { label: ja.cancel, aliases: ["cancel"], run: () => frame.remove() },
    ]),
  });
  draw();
  width.focus();
}
