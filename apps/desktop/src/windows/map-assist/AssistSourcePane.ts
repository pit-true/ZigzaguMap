import type { PartCell, PartGrid } from "@zigzagumap/core";
import { jaAssist as t } from "../../i18n/ja.assist";
import { shadeTripleChild } from "../../ui/tripleLayerShade";
import { BLOCK, buttonEl, canvasEl, div, imageCanvas, paletteBlock, palettePos } from "./assistDom";
import type { AssistData, AssistImage } from "./protocol";

/** 左で選んだ所（枠に入れる並び）。 */
export interface Picked {
  readonly x: number;
  readonly y: number;
  readonly grid: PartGrid;
}

/** 左の欄が使う窓口。 */
export interface AssistSourceHost {
  /** マップの画像をメインから受け取る（「マップ」のタブを初めて開いたとき）。 */
  mapImage(): Promise<AssistImage>;
  /** 処理を動かし、失敗したらステータスに出す。 */
  run(action: () => Promise<void>): Promise<void>;
}

/**
 * マップ作成補助の左の欄（#312）。「ブロック一覧」「マップ」のタブと、その画像の上のドラッグで範囲を選ぶ。
 * 3 層の次の番号は、メインのパレットと同じく薄くして斜線を引き、1 つだけ押したら 1 つ前の 3 層のブロックを選ぶ（#338）。
 */
export class AssistSourcePane {
  readonly element = div("assist-left");
  readonly canvas = canvasEl("assist.source");
  private data: AssistData | null = null;
  private tabValue: "blocks" | "map" = "blocks";
  private pickedValue: Picked | null = null;
  private atlasValue: HTMLCanvasElement | null = null;
  private mapAtlas: HTMLCanvasElement | null = null;
  private dragFrom: { x: number; y: number } | null = null;
  private readonly box = div("assist-source-box");
  private readonly selectionLabel = div("assist-note");
  private readonly tabBlocks = buttonEl("assist.tabBlocks", t.tabBlocks, () => this.setTab("blocks"));
  private readonly tabMap = buttonEl("assist.tabMap", t.tabMap, () => this.setTab("map"));

  constructor(private readonly host: AssistSourceHost) {
    const tabs = div("assist-tabs");
    tabs.append(this.tabBlocks, this.tabMap);
    this.box.append(this.canvas);
    this.element.append(tabs, this.box, this.selectionLabel);
    this.canvas.addEventListener("pointerdown", (e) => this.pointer(e, "down"));
    this.canvas.addEventListener("pointermove", (e) => this.pointer(e, "move"));
    this.canvas.addEventListener("pointerup", (e) => this.pointer(e, "up"));
  }

  /** 開いているタブ。 */
  get tab(): "blocks" | "map" {
    return this.tabValue;
  }

  /** 選んだ所（無ければ null）。 */
  get picked(): Picked | null {
    return this.pickedValue;
  }

  /** ブロック一覧の画像（枠の絵に使う）。 */
  get atlas(): HTMLCanvasElement | null {
    return this.atlasValue;
  }

  /**
   * 今のマップの組のことを受け取る。`changed` はタイルセットの組が変わったとき（マップの画像を読み直す）、
   * `clearPick` は選んだ所を捨てるとき。描き直しは `render` で行う。
   */
  setData(data: AssistData, changed: boolean, clearPick: boolean): void {
    this.data = data;
    const children = new Set(data.tripleChildren);
    this.atlasValue = imageCanvas(data.palette, (rgba, width) => {
      for (const b of children) {
        const p = palettePos(b);
        shadeTripleChild(rgba, width, p.col * BLOCK, p.row * BLOCK);
      }
    });
    if (clearPick) this.pickedValue = null;
    if (changed) this.mapAtlas = null;
  }

  setTab(tab: "blocks" | "map"): void {
    this.tabValue = tab;
    this.pickedValue = null;
    this.tabBlocks.classList.toggle("active", tab === "blocks");
    this.tabMap.classList.toggle("active", tab === "map");
    if (tab === "map" && !this.mapAtlas) {
      void this.host.run(async () => {
        this.mapAtlas = imageCanvas(await this.host.mapImage());
        this.render();
      });
    }
    this.render();
  }

  render(): void {
    const src = this.tabValue === "blocks" ? this.atlasValue : this.mapAtlas;
    const c = this.canvas;
    if (!src) {
      c.width = c.height = 0;
      return;
    }
    const zoom = this.zoom;
    c.width = src.width * zoom;
    c.height = src.height * zoom;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    const p = this.pickedValue;
    if (p) {
      const s = BLOCK * zoom;
      g.strokeStyle = "#ff0000";
      g.lineWidth = 2;
      g.strokeRect(p.x * s + 1, p.y * s + 1, p.grid.width * s - 2, p.grid.height * s - 2);
    }
    this.selectionLabel.textContent = p ? t.selection(p.x, p.y, p.grid.width, p.grid.height) : t.noSelection;
  }

  private get zoom(): number {
    return this.tabValue === "blocks" ? 2 : 1;
  }

  /** 画像の上のドラッグで範囲を選ぶ。 */
  private pointer(e: PointerEvent, type: "down" | "move" | "up"): void {
    const zoom = this.zoom;
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (BLOCK * zoom));
    const y = Math.floor((e.clientY - r.top) / (BLOCK * zoom));
    if (type === "down") {
      this.dragFrom = { x, y };
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 自動操作のイベントは捕まえられない */
      }
    }
    if (!this.dragFrom || (type === "move" && e.buttons === 0)) return;
    this.pick(this.dragFrom, { x, y });
    if (type === "up") this.dragFrom = null;
  }

  private pick(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const data = this.data;
    if (!data) return;
    const x0 = Math.max(0, Math.min(a.x, b.x));
    const y0 = Math.max(0, Math.min(a.y, b.y));
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const cells: (PartCell | null)[] = [];
    const children = new Set(data.tripleChildren);
    const blocks = this.tabValue === "blocks";
    if (blocks && x0 === x1 && y0 === y1) {
      // 3 層の次の番号を 1 つ押したら、1 つ前の 3 層のブロックを選ぶ（メインのパレットと同じ。#338）
      const block = paletteBlock(x0, y0, data.secondaryCount);
      if (block !== null && children.has(block)) {
        const p = palettePos(block - 1);
        this.pickedValue = { x: p.col, y: p.row, grid: { width: 1, height: 1, cells: [{ block: block - 1, movement: null }] } };
        return this.render();
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (blocks) {
          const block = paletteBlock(x, y, data.secondaryCount);
          // 矩形に入った次の番号は空き（書かないマス）にする
          cells.push(block === null || children.has(block) ? null : { block, movement: null });
        } else {
          const v = x < data.map.width && y < data.map.height ? data.map.cells[y * data.map.width + x] : undefined;
          cells.push(v === undefined ? null : { block: v & 0x3ff, movement: v >> 10 });
        }
      }
    }
    this.pickedValue = { x: x0, y: y0, grid: { width: x1 - x0 + 1, height: y1 - y0 + 1, cells } };
    this.render();
  }
}
