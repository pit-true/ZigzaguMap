import type { EditorState } from "../../app/EditorState";
import { canvasPng, release, writeClipboard, type CompositeImage, type CompositeOptions } from "../../app/CompositeImage";
import { encodeDib } from "../../app/ImageExport";
import { folderOf, writeFile, type FileDialogs } from "../../app/FileDialogs";
import type { Timelapse } from "../../app/Timelapse";
import { jaMapExport as t } from "../../i18n/ja.mapExport";
import { normalizeGridStyle } from "../map/gridStyle";
import "../../styles/mapExport.css";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";

/** 窓が使う機能（App が渡す）。 */
export interface MapExportHost {
  readonly state: EditorState;
  readonly files: FileDialogs;
  readonly composite: CompositeImage;
  readonly timelapse: Timelapse;
}

/** 窓の選択（自動操作の `mapExport.state` にも出す）。 */
export interface MapExportChoice {
  whole: boolean;
  persons: boolean;
  warps: boolean;
  traps: boolean;
  signs: boolean;
  movement: boolean;
  grid: boolean;
  border: boolean;
  neighbors: boolean;
  format: "png" | "bmp";
  delayMs: number;
  skip: number;
}

/** 窓の選択から画像の作り方を作る。 */
export function compositeOptionsOf(c: MapExportChoice, gridStyle: unknown = null): Omit<CompositeOptions, "ask" | "scale"> {
  return {
    whole: c.whole,
    events: "none",
    eventKinds: { persons: c.persons, warps: c.warps, traps: c.traps, signs: c.signs },
    movement: c.movement,
    border: c.border,
    neighbors: !c.whole && c.neighbors,
    grid: c.grid ? normalizeGridStyle(gridStyle) : null,
  };
}

const PREVIEW_W = 360;
const PREVIEW_H = 240;

/** 開いている窓（自動操作用。無ければ null）。 */
let current: MapExportDialog | null = null;

/** 開いている書き出しの窓。 */
export function openMapExport(): MapExportDialog | null {
  return current;
}

/**
 * ファイル > マップの画像を書き出す...（Phase5 #403）。範囲（このマップ・接続している全マップ）、含めるもの（イベントの種類・
 * 移動許可・周りの境界ブロック・周りの隣のマップの帯）、形式（PNG・BMP）を選び、プレビューを見てファイルかクリップボードへ書く。
 * 同じ選択で、このマップのタイムラプスの GIF も書ける。前の選択は個人設定に残さない（開くたびに初めの値）。
 */
export class MapExportDialog {
  readonly choice: MapExportChoice = {
    whole: false,
    persons: true,
    warps: true,
    traps: true,
    signs: true,
    movement: false,
    grid: false,
    border: false,
    neighbors: false,
    format: "png",
    delayMs: 200,
    skip: 0,
  };
  private readonly frame;
  private readonly preview: HTMLCanvasElement;
  private readonly sizeLabel: HTMLElement;
  private readonly fields = new Map<keyof MapExportChoice, HTMLInputElement>();
  /** 最後に作ったプレビューの大きさ（自動操作用）。 */
  last: { width: number; height: number; maps: number; scale: number } | null = null;
  private rendering: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly host: MapExportHost) {
    current?.close();
    current = this;
    this.frame = createDialog({ title: t.title, className: "map-export-dialog", onClose: () => this.close() });
    const body = this.frame.body;
    const group = (title: string, ...children: HTMLElement[]): HTMLElement => {
      const box = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = title;
      box.append(legend, ...children);
      return box;
    };
    const radio = (key: "whole" | "format", value: boolean | string, label: string, id: string): HTMLElement => {
      const l = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `mapExport.${key}`;
      input.checked = this.choice[key] === value;
      input.dataset["autoId"] = `mapExport.${id}`;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        (this.choice as unknown as Record<string, unknown>)[key] = value;
        this.changed();
      });
      l.append(input, label);
      return l;
    };
    const check = (key: "persons" | "warps" | "traps" | "signs" | "movement" | "grid" | "border" | "neighbors", label: string): HTMLElement => {
      const l = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = this.choice[key];
      input.dataset["autoId"] = `mapExport.${key}`;
      input.addEventListener("change", () => {
        this.choice[key] = input.checked;
        this.changed();
      });
      this.fields.set(key, input);
      l.append(input, label);
      return l;
    };
    const number = (key: "delayMs" | "skip", label: string, min: number, max: number): HTMLElement => {
      const l = document.createElement("label");
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(min);
      input.max = String(max);
      input.value = String(this.choice[key]);
      input.dataset["autoId"] = `mapExport.${key}`;
      input.addEventListener("change", () => {
        const v = Math.round(Number(input.value));
        this.choice[key] = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : this.choice[key];
        input.value = String(this.choice[key]);
      });
      l.append(label, input);
      return l;
    };
    this.preview = document.createElement("canvas");
    this.preview.width = PREVIEW_W;
    this.preview.height = PREVIEW_H;
    this.preview.className = "map-export-preview";
    this.preview.dataset["autoId"] = "mapExport.preview";
    this.sizeLabel = document.createElement("div");
    this.sizeLabel.className = "map-export-size";
    this.sizeLabel.dataset["autoId"] = "mapExport.size";
    const left = document.createElement("div");
    left.className = "map-export-options";
    left.append(
      group(t.range, radio("whole", false, t.rangeMap, "rangeMap"), radio("whole", true, t.rangeWhole, "rangeWhole")),
      group(
        t.include,
        check("persons", t.persons),
        check("warps", t.warps),
        check("traps", t.traps),
        check("signs", t.signs),
        check("movement", t.movement),
        check("grid", t.grid),
        check("border", t.border),
        check("neighbors", t.neighbors),
      ),
      group(t.format, radio("format", "png", t.png, "png"), radio("format", "bmp", t.bmp, "bmp")),
    );
    const note = document.createElement("div");
    note.className = "map-export-note";
    note.textContent = t.timelapseNote;
    const right = document.createElement("div");
    right.className = "map-export-right";
    right.append(
      group(t.preview, this.preview, this.sizeLabel),
      group(t.timelapse, note, number("delayMs", t.timelapseDelay, 10, 10000), number("skip", t.timelapseSkip, 0, 1000), dialogButton(t.timelapseSave, () => void this.saveTimelapse())),
    );
    const main = document.createElement("div");
    main.className = "map-export-main";
    main.append(left, right);
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const save = dialogButton(t.save, () => void this.save());
    save.dataset["autoId"] = "mapExport.save";
    const copy = dialogButton(t.copy, () => void this.copy());
    copy.dataset["autoId"] = "mapExport.copy";
    const close = dialogButton(t.close, () => this.close());
    buttons.append(save, copy, close);
    body.append(main, buttons);
    handleDialogKeys(this.frame, () => this.close());
    this.frame.register({
      title: t.title,
      text: "",
      ...pressable([
        { label: t.save, run: () => void this.save() },
        { label: t.copy, run: () => void this.copy() },
        { label: t.timelapseSave, run: () => void this.saveTimelapse() },
        { label: t.close, aliases: ["close", "cancel"], run: () => this.close() },
      ]),
    });
    this.changed();
  }

  /** プレビューを作り終えるまで待つ（自動操作用）。 */
  settle(): Promise<void> {
    return this.rendering;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.frame.remove();
    this.preview.width = 0;
    this.preview.height = 0;
    if (current === this) current = null;
  }

  /** ファイルに保存する。保存したパス（取りやめたら null）。 */
  async save(): Promise<string | null> {
    const png = this.choice.format === "png";
    const r = await this.host.composite.render({ ...compositeOptionsOf(this.choice, this.host.state.settings.data.gridStyle), ask: true });
    if (!r) return null;
    try {
      const settings = this.host.state.settings;
      const ext = png ? "png" : "bmp";
      let path = await this.host.files.saveFile({
        title: t.title,
        filters: [{ name: png ? t.pngFilter : t.bmpFilter, extensions: [ext] }],
        directory: settings.data.imageDir,
        fileName: `${this.baseName()}.${ext}`,
      });
      if (!path) return null;
      if (!/\.[^\\/.]+$/.test(path)) path += `.${ext}`;
      const c = r.canvas;
      const data = png
        ? new Uint8Array(await (await canvasPng(c)).arrayBuffer())
        : encodeDib({ width: c.width, height: c.height, data: c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data });
      await writeFile(path, data);
      settings.update({ imageDir: folderOf(path) });
      this.host.state.setStatus(t.saved(path));
      return path;
    } finally {
      release(r.canvas);
    }
  }

  /** クリップボードへコピーする。 */
  async copy(): Promise<{ width: number; height: number } | null> {
    const r = await this.host.composite.render({ ...compositeOptionsOf(this.choice, this.host.state.settings.data.gridStyle), ask: true });
    if (!r) return null;
    try {
      await writeClipboard(r.canvas);
      this.host.state.setStatus(t.copied(r.canvas.width, r.canvas.height));
      return { width: r.canvas.width, height: r.canvas.height };
    } finally {
      release(r.canvas);
    }
  }

  /** タイムラプスの GIF を保存する。保存したパスとコマの数（取りやめた・変更が無ければ null）。 */
  async saveTimelapse(): Promise<{ path: string; frames: number; width: number; height: number } | null> {
    const { state, files, timelapse } = this.host;
    if (timelapse.positions(this.choice.skip).length === 0) {
      state.setStatus(t.timelapseNone, undefined, true);
      return null;
    }
    const settings = state.settings;
    let path = await files.saveFile({
      title: t.timelapse,
      filters: [{ name: t.gifFilter, extensions: ["gif"] }],
      directory: settings.data.imageDir,
      fileName: `${this.baseName()}_timelapse.gif`,
    });
    if (!path) return null;
    if (!/\.[^\\/.]+$/.test(path)) path += ".gif";
    const r = await timelapse.render(compositeOptionsOf(this.choice, this.host.state.settings.data.gridStyle), { delayMs: this.choice.delayMs, skip: this.choice.skip });
    if (!r) return null;
    await writeFile(path, r.gif);
    settings.update({ imageDir: folderOf(path) });
    state.setStatus(t.timelapseSaved(r.frames, path));
    this.changed();
    return { path, frames: r.frames, width: r.width, height: r.height };
  }

  /** ファイル名の初めの値（`map_3_0`）。 */
  private baseName(): string {
    const id = this.host.state.map?.id;
    return id ? `map_${id.bank}_${id.map}` : "map";
  }

  /** 選択が変わった: 「隣のマップの帯」は「このマップ」のときだけ押せる。プレビューを作り直す。 */
  private changed(): void {
    const neighbors = this.fields.get("neighbors");
    if (neighbors) neighbors.disabled = this.choice.whole;
    this.rendering = this.rendering.then(() => this.renderPreview());
  }

  private async renderPreview(): Promise<void> {
    if (this.closed) return;
    const r = await this.host.composite.render({ ...compositeOptionsOf(this.choice, this.host.state.settings.data.gridStyle), ask: false });
    if (this.closed || !r) {
      if (r) release(r.canvas);
      return;
    }
    const c = this.preview.getContext("2d")!;
    c.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    const k = Math.min(1, PREVIEW_W / r.canvas.width, PREVIEW_H / r.canvas.height);
    const w = Math.max(1, Math.round(r.canvas.width * k));
    const h = Math.max(1, Math.round(r.canvas.height * k));
    c.imageSmoothingEnabled = k < 1;
    c.drawImage(r.canvas, Math.floor((PREVIEW_W - w) / 2), Math.floor((PREVIEW_H - h) / 2), w, h);
    this.last = { width: r.canvas.width, height: r.canvas.height, maps: r.drawn, scale: r.scale };
    this.sizeLabel.textContent = t.size(r.canvas.width, r.canvas.height, r.drawn, r.scale);
    release(r.canvas);
  }
}
