import { placementProblem, TRANSPARENT, writeBgr555, type ImportLayers, type ImportPlan } from "@zigzagumap/core";
import { jaTileImport as t } from "../../i18n/ja.tileImport";
import { autoId, button, check, label, place } from "../../ui/form/controls";
import { pixelCanvas, pointIn, putRgba, resizePixelCanvas } from "../block-editor/pixelCanvas";
import type { TilesetModel } from "../TilesetModel";
import type { ImportOptionsJson } from "./importOptions";

/** 画像のマスと書く先を並べ、形を保ったまま置き場所を決める。 */
export class PlacePage {
  readonly root = place(document.createElement("div"), 8, 34, 784, 372);
  private readonly source = pixelCanvas("ti.place.source", 16, 16, 2);
  private readonly target = pixelCanvas("ti.place.target", 128, 16, 2);
  private readonly info = autoId(label("", 0, 346, 780), "ti.placeInfo");
  private readonly reason = autoId(label("", 0, 324, 780), "ti.placeReason");
  private readonly replace = check("ti.allowReplace", t.allowReplace, 366, 22, 410);
  private readonly selected = new Set<number>();
  private plan: ImportPlan | null = null;
  private layers: ImportLayers | null = null;
  private start: { cell: number; x: number; y: number; fromTarget: boolean } | null = null;

  constructor(private readonly options: ImportOptionsJson, private readonly changed: () => void, private readonly used: (block: number) => number) {
    this.root.className += " ti-page";
    const frame = (canvas: HTMLCanvasElement, x: number, w: number): HTMLElement => {
      const f = place(document.createElement("div"), x, 52, w, 266);
      f.className += " ti-frame";
      f.append(canvas);
      return f;
    };
    this.root.append(label(t.placeHead, 0, 0, 780),
      button("ti.autoPlace", t.autoPlace, 0, 22, 170, 25, () => this.reset()),
      button("ti.resetPlace", t.resetPlace, 180, 22, 170, 25, () => this.reset()),
      this.replace.root, frame(this.source, 0, 500), frame(this.target, 512, 272), this.reason, this.info);
    this.replace.input.addEventListener("change", () => {
      this.options.allowReplace = this.replace.input.checked;
      this.changed();
    });
    this.source.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.plan) return;
      const cell = this.sourceCell(e);
      if (cell < 0 || this.plan.cellBlocks[cell]! < 0) return;
      if (e.ctrlKey) {
        if (this.selected.has(cell)) this.selected.delete(cell); else this.selected.add(cell);
      } else if (!this.selected.has(cell)) {
        this.selected.clear();
        this.selected.add(cell);
      }
      this.start = { cell, x: e.clientX, y: e.clientY, fromTarget: false };
      if (e.isTrusted) this.source.setPointerCapture(e.pointerId);
      this.drawSelection();
    });
    this.source.addEventListener("pointerup", (e) => {
      const start = this.start;
      this.start = null;
      if (!start || !this.plan) return;
      const local = this.targetLocal(e);
      if (local >= 0) this.put(local, start.cell);
      else if (!e.ctrlKey && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) {
        const end = this.sourceCell(e);
        if (end < 0) return;
        const width = this.plan.cellsWide;
        this.selected.clear();
        for (let y = Math.min(Math.floor(start.cell / width), Math.floor(end / width)); y <= Math.max(Math.floor(start.cell / width), Math.floor(end / width)); y++)
          for (let x = Math.min(start.cell % width, end % width); x <= Math.max(start.cell % width, end % width); x++) {
            const cell = y * width + x;
            if (this.plan.cellBlocks[cell]! >= 0) this.selected.add(cell);
          }
        this.drawSelection();
      }
    });
    this.target.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const local = this.targetLocal(e);
      const b = this.plan?.locals.findIndex((l, i) => l === local || (this.plan!.built[i]!.third !== null && l + 1 === local)) ?? -1;
      if (b < 0) return;
      const entries = new Map(this.options.placement);
      entries.set(b, -1);
      this.options.placement = [...entries];
      this.changed();
    });
    this.target.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.plan) return;
      const local = this.targetLocal(e);
      const b = this.plan.locals.findIndex((l) => l === local);
      if (b < 0) return;
      const cell = this.plan.built[b]!.cells[0]!;
      if (!this.selected.has(cell)) { this.selected.clear(); this.selected.add(cell); }
      this.start = { cell, x: e.clientX, y: e.clientY, fromTarget: true };
      if (e.isTrusted) this.target.setPointerCapture(e.pointerId);
      this.drawSelection();
    });
    this.target.addEventListener("pointerup", (e) => {
      const start = this.start;
      this.start = null;
      if (start?.fromTarget) this.put(this.targetLocal(e), start.cell);
    });
  }

  private reset(): void { this.options.placement = []; this.reason.textContent = ""; this.changed(); }
  private sourceCell(e: MouseEvent): number {
    if (!this.plan) return -1;
    const p = pointIn(this.source, e);
    const x = Math.floor(p.x / 32), y = Math.floor(p.y / 32);
    return x >= 0 && y >= 0 && x < this.plan.cellsWide && y < this.plan.cellsHigh ? y * this.plan.cellsWide + x : -1;
  }
  private targetLocal(e: MouseEvent): number {
    const p = pointIn(this.target, e);
    return p.x >= 0 && p.y >= 0 && p.x < 256 && p.y < this.target.height * 2 ? Math.floor(p.y / 32) * 8 + Math.floor(p.x / 32) : -1;
  }
  private put(local: number, anchor: number): void {
    const plan = this.plan;
    if (!plan || local < 0) return;
    const entries = new Map(this.options.placement);
    const moving = new Map<number, number>();
    for (const cell of this.selected) {
      const b = plan.cellBlocks[cell]!;
      if (b < 0 || moving.has(b)) continue;
      const dx = cell % plan.cellsWide - anchor % plan.cellsWide;
      const dy = Math.floor(cell / plan.cellsWide) - Math.floor(anchor / plan.cellsWide);
      if (local % 8 + dx < 0 || local % 8 + dx >= 8) { this.reason.textContent = t.placeReasons["outside"]!; return; }
      moving.set(b, local + dx + dy * 8);
    }
    const taken = new Set<number>();
    plan.locals.forEach((l, b) => { if (l >= 0 && !moving.has(b)) { taken.add(l); if (plan.built[b]!.third) taken.add(l + 1); } });
    for (const [b, at] of moving) {
      const triple = plan.built[b]!.third !== null;
      const problem = placementProblem({ ...plan.table, used: this.used }, at, triple, this.options.allowReplace ?? false, taken);
      if (problem) { this.reason.textContent = t.placeHover(plan.table.base + at, t.placeReasons[problem]!); return; }
      taken.add(at); if (triple) taken.add(at + 1);
      entries.set(b, at);
    }
    this.options.placement = [...entries];
    this.reason.textContent = "";
    this.changed();
  }

  render(plan: ImportPlan | null, layers: ImportLayers | null, model: TilesetModel): void {
    this.plan = plan; this.layers = layers;
    this.replace.input.checked = this.options.allowReplace ?? false;
    if (!plan || !layers) return;
    this.drawSelection();
    const rows = Math.ceil(plan.table.capacity / 8);
    resizePixelCanvas(this.target, 128, rows * 16, 2);
    const data = new Uint8ClampedArray(128 * rows * 16 * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    for (let l = 0; l < plan.table.capacity; l++) model.renderer?.blit(plan.table.base + l, data, 128, l % 8 * 16, Math.floor(l / 8) * 16);
    putRgba(this.target, data);
    const ctx = this.target.getContext("2d")!;
    for (let l = 0; l < plan.table.capacity; l++) {
      const x = l % 8 * 16, y = Math.floor(l / 8) * 16;
      if (placementProblem({ ...plan.table, used: this.used }, l, false, false) === null) { ctx.strokeStyle = "#40c060"; ctx.setLineDash([2, 2]); ctx.strokeRect(x + .5, y + .5, 15, 15); }
      if (this.used(plan.table.base + l)) { ctx.fillStyle = "#f04040"; ctx.fillRect(x + 12, y, 4, 4); }
    }
    ctx.setLineDash([]);
    plan.locals.forEach((l, b) => {
      if (l < 0) return;
      const cell = plan.built[b]!.cells[0]!;
      const x = l % 8 * 16, y = Math.floor(l / 8) * 16;
      ctx.drawImage(this.source, cell % plan.cellsWide * 16, Math.floor(cell / plan.cellsWide) * 16, 16, 16, x, y, 16, 16);
      ctx.strokeStyle = "#ffff00"; ctx.strokeRect(x + .5, y + .5, 15, 15);
    });
    this.info.textContent = `${t.placeInfo(plan.locals.filter((l) => l >= 0).length, plan.built.length, plan.blocks.unplaced, plan.blocks.replaced)}　${t.placeLegend}`;
  }
  private drawSelection(): void {
    const plan = this.plan, layers = this.layers;
    if (!plan || !layers) return;
    resizePixelCanvas(this.source, layers.width, layers.height, 2);
    const data = new Uint8ClampedArray(layers.width * layers.height * 4);
    for (let i = 0; i < layers.width * layers.height; i++) {
      let color = TRANSPARENT;
      for (const layer of plan.reducedLayers ?? layers.layers) if (layer[i] !== TRANSPARENT) color = layer[i]!;
      if (color === TRANSPARENT) data.set([200, 200, 200, 255], i * 4); else writeBgr555(data, i, color);
    }
    putRgba(this.source, data);
    const ctx = this.source.getContext("2d")!;
    ctx.strokeStyle = "#ffff00";
    for (const cell of this.selected) ctx.strokeRect(cell % plan.cellsWide * 16 + .5, Math.floor(cell / plan.cellsWide) * 16 + .5, 15, 15);
  }
  dispose(): void { for (const c of [this.source, this.target]) { c.width = 0; c.height = 0; } this.plan = null; this.layers = null; }
}
