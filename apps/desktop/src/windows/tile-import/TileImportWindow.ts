import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  PRIMARY_PALETTE_COUNT,
  TOTAL_PALETTE_COUNT,
  TRANSPARENT,
  decodeBase64,
  decodeRgbaPng,
  encodeBase64,
  formatHex,
  rgbaToColor,
  writeBgr555,
  type ImportLayers,
  type ImportPlan,
  type ImportSource,
  type ImportTable,
} from "@zigzagumap/core";
import { FileDialogs, fileNameOf, folderOf, readFile } from "../../app/FileDialogs";
import { jaTileImport as t } from "../../i18n/ja.tileImport";
import { autoId, button, check, combo, edit, label, place } from "../../ui/form/controls";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../../ui/Dialog";
import { showError } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { pixelCanvas, pointIn, putRgba, resizePixelCanvas } from "../block-editor/pixelCanvas";
import { installToolAutomation } from "../toolAutomation";
import type { ToolClient } from "../ToolClient";
import { TilesetModel } from "../TilesetModel";
import { IMPORT_TARGETS, targetOf, type ImportOptionsJson } from "./importOptions";
import type { ImportContextData, TileImportOutcome } from "./tileImportHost";
import type { PlanRequest, PlanResponse } from "./planWorker";
import { pickBaseBlock } from "./BlockPickerDialog";
import { PlacePage } from "./PlacePage";

/** ページの数。 */
const PAGES = 5;
/** 中身の面の大きさ。 */
const BODY = { x: 8, y: 34, width: 784, height: 372 } as const;

/** 開いた画像 1 枚。 */
interface OpenedImage {
  readonly path: string;
  readonly png: Uint8Array;
  readonly source: ImportSource;
}

/** ページの部品をまとめて持つ。 */
interface PageParts {
  readonly root: HTMLElement;
  render(): void;
}

/**
 * 画像からタイルとブロックを作るウィザード（Phase6 #444。別ウィンドウ `tile-import`）。ブロックエディタの タイル > 画像からタイルとブロックを作る… で開く。
 *
 * - 1. 画像（1〜3 枚）・書く先・透明色 → 2. パレット → 3. 作り方 → 4. 置き場所 → 5. 確認 の順。どのページにも、タイル・ブロック・パレットの
 *   「使う / 空き / 上限」のメーターと問題の一覧を出し、誤り（×）があれば次へ進めない。
 * - 計画は Worker（planWorker）で作る（設定を変えるたびに作り直す）。メインからは使用回数と、同じ主を使うほかの組の副のブロックだけをもらう。
 * - パレットが足りなければ、警告の窓で今のパレットの数を伝え、「減色する」か「キャンセル」を選ばせる（#441・#444 のユーザーの返事）。
 * - 「取り込む」で、画像（PNG）と設定をメインへ送り、メインが今の中身で計画を作り直して 1 回のコマンドで書く（頼み `importTiles`）。
 */
export class TileImportWindow {
  private model: TilesetModel;
  private readonly files = new FileDialogs();
  private directory: string | null = null;
  private readonly images: (OpenedImage | null)[] = [null, null, null];
  private page = 0;
  private plan: ImportPlan | null = null;
  private layers: ImportLayers | null = null;
  private planError: string | null = null;
  private computing = false;
  private seq = 0;
  private sentSources = -1;
  private sourcesVersion = 0;
  private context: ImportContextData | null = null;
  private contextVersion = -1;
  private others: Uint16Array[] = [];
  private pickedColor: number | null = null;
  private status = "";
  private worker: Worker | null = null;
  /** 開けておく設定。 */
  readonly options: ImportOptionsJson = { useFlip: true, reuseExisting: true, skipEmpty: true, mergeSame: true, mode: "picture", upperBehind: false, baseBlock: null, reduce: false, excludedPalettes: [], reserveDoorTiles: true, placement: [], allowReplace: false };
  private readonly pages: PageParts[] = [];
  private readonly stepLabels: HTMLElement[] = [];
  private readonly meters: { root: HTMLElement; bar: HTMLElement; text: HTMLElement }[] = [];
  private readonly problemList: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly runButton: HTMLButtonElement;
  private readonly canvases: HTMLCanvasElement[] = [];
  /** ページ 1 の部品。 */
  private readonly fileLabels: HTMLElement[] = [];
  private readonly target: HTMLSelectElement;
  private readonly transparentMode: HTMLSelectElement;
  private readonly swatch: HTMLElement;
  private readonly preview: HTMLCanvasElement;
  private readonly imageInfo: HTMLElement;
  private previewScale = 1;

  static start(root: HTMLElement, client: ToolClient): TileImportWindow {
    return new TileImportWindow(root, client);
  }

  private constructor(
    private readonly root: HTMLElement,
    private readonly client: ToolClient,
  ) {
    this.model = new TilesetModel(client.snapshot, client.ui);
    root.classList.add("tile-import");
    t.steps.forEach((s, i) => {
      const el = autoId(label(s, 8 + i * 110, 10, 104), `ti.step.${i}`);
      el.classList.add("ti-step");
      this.stepLabels.push(el);
      root.append(el);
    });

    // ---- 1. 画像 ----
    const p1 = this.pageRoot();
    t.layerNames.forEach((name, i) => {
      const y = 4 + i * 26;
      const path = autoId(label(t.noFile, 300, y + 3, 330), `ti.file.${i}`);
      path.classList.add("ti-path");
      this.fileLabels.push(path);
      p1.append(label(name, 0, y + 3, 230), button(`ti.open.${i}`, t.open, 232, y, 60, 22, () => void this.openImage(i)), path, button(`ti.clear.${i}`, t.clear, 640, y, 50, 22, () => this.clearImage(i)));
    });
    this.target = combo("ti.target", [...t.targetNames], 232, 86, 260);
    this.transparentMode = combo("ti.transparentMode", [...t.transparentNames], 232, 112, 200);
    this.swatch = place(document.createElement("span"), 440, 112, 19, 19);
    this.swatch.className += " ti-swatch";
    this.preview = pixelCanvas("ti.preview", 16, 16, 1);
    this.canvases.push(this.preview);
    const frame = place(document.createElement("div"), 0, 164, 500, 206);
    frame.className += " ti-frame";
    frame.append(this.preview);
    this.imageInfo = autoId(label("", 508, 164, 276), "ti.imageInfo");
    this.imageInfo.classList.add("ti-info");
    const hint = label(t.transparentHint, 0, 140, 784);
    hint.classList.add("ti-note");
    p1.append(label(t.target, 0, 89, 230), this.target, label(t.transparent, 0, 115, 230), this.transparentMode, this.swatch, hint, frame, this.imageInfo);
    this.target.addEventListener("change", () => this.replan());
    this.transparentMode.addEventListener("change", () => this.replan());
    this.preview.addEventListener("pointerdown", (e) => this.pickTransparent(e));
    this.pages.push({ root: p1, render: () => this.renderImagePage() });

    // ---- 2〜5 ----
    this.pages.push(this.palettePage(), this.methodPage(), this.placePage(), this.confirmPage());

    // ---- メーター・問題・ボタン ----
    [t.meterTiles, t.meterBlocks, t.meterPalettes].forEach((name, i) => {
      const x = 8 + i * 262;
      const m = place(document.createElement("div"), x, 412, 256, 30);
      m.className += " ti-meter";
      autoId(m, `ti.meter.${["tiles", "blocks", "palettes"][i]}`);
      const head = document.createElement("span");
      head.className = "ti-meter-head";
      head.textContent = name;
      const track = document.createElement("div");
      track.className = "ti-meter-track";
      const bar = document.createElement("div");
      bar.className = "ti-meter-bar";
      track.append(bar);
      const text = document.createElement("span");
      text.className = "ti-meter-text";
      m.append(head, text, track);
      this.meters.push({ root: m, bar, text });
      root.append(m);
    });
    this.problemList = autoId(place(document.createElement("div"), 8, 446, 784, 58), "ti.problems");
    this.problemList.className += " ti-problems";
    this.statusLine = autoId(label("", 8, 512, 440), "ti.status");
    this.statusLine.classList.add("ti-path");
    this.backButton = button("ti.back", t.back, 452, 508, 80, 25, () => this.go(this.page - 1));
    this.nextButton = button("ti.next", t.next, 536, 508, 80, 25, () => void this.next());
    this.runButton = button("ti.run", t.run, 620, 508, 84, 25, () => void this.run());
    root.append(this.problemList, this.statusLine, this.backButton, this.nextButton, this.runButton, button("ti.close", t.close, 708, 508, 84, 25, () => void getCurrentWindow().close()));
    for (const p of this.pages) root.append(p.root);

    client.onSnapshot(() => {
      this.model = new TilesetModel(client.snapshot, client.ui);
      this.replan();
    });
    void getCurrentWindow()
      .setTitle(t.title)
      .catch(() => undefined);
    void getCurrentWindow()
      .onCloseRequested(() => this.dispose())
      .catch(() => undefined);
    void installToolAutomation(client, {
      files: this.files,
      actions: {},
      describe: () => this.describe(),
      extra: (req) => (req["cmd"] === "tileImport.wait" ? this.waitPlan() : undefined),
    });
    this.go(0);
  }

  // ---- ページの土台 ----

  private pageRoot(): HTMLElement {
    const p = place(document.createElement("div"), BODY.x, BODY.y, BODY.width, BODY.height);
    p.className += " ti-page";
    return p;
  }

  private go(page: number): void {
    this.page = Math.max(0, Math.min(PAGES - 1, page));
    this.pages.forEach((p, i) => (p.root.hidden = i !== this.page));
    this.stepLabels.forEach((s, i) => s.classList.toggle("ti-step-current", i === this.page));
    this.render();
  }

  /** 次のページへ（誤りがあれば進めない。パレットが足りなければ減色するか聞く）。 */
  private async next(): Promise<void> {
    await this.waitPlan();
    if (!this.layers) {
      this.showStatus(this.planError ?? t.needImage);
      return;
    }
    if (this.plan?.paletteShortage && !this.options.reduce) {
      if (!(await this.askReduce())) return;
      this.options.reduce = true;
      this.replan();
      await this.waitPlan();
    }
    if (!this.plan || this.plan.problems.some((p) => p.level === "error" && (this.page >= 3 || !["blocksShort", "placementInvalid"].includes(p.code)))) {
      this.showStatus(t.cannotNext);
      return;
    }
    this.go(this.page + 1);
  }

  /** パレットが足りないときの警告の窓。「減色する」なら true。 */
  private askReduce(): Promise<boolean> {
    const plan = this.plan!;
    const pal = plan.palettes;
    return new Promise((resolve) => {
      const finish = (ok: boolean): void => {
        frame.remove();
        resolve(ok);
      };
      const frame = createDialog({ title: t.shortageTitle, width: 440, onClose: () => finish(false) });
      const text = document.createElement("div");
      text.className = "ti-dialog-text";
      text.textContent = t.shortageText(pal.usedSlots.length, pal.capacity, pal.free, pal.needed, plan.problems.some((p) => p.code === "palettesShort" && p.params["atLeast"] === 1), pal.overColorTiles);
      frame.body.append(text, dialogButtonRow(dialogButton(t.shortageReduce, () => finish(true)), dialogButton(t.shortageCancel, () => finish(false))));
      handleDialogKeys(frame, () => finish(false));
      frame.register({
        title: t.shortageTitle,
        text: text.textContent,
        ...pressable([
          { label: t.shortageReduce, aliases: ["reduce", "ok"], run: () => finish(true) },
          { label: t.shortageCancel, aliases: ["cancel"], run: () => finish(false) },
        ]),
      });
    });
  }

  // ---- 画像 ----

  private async openImage(i: number): Promise<void> {
    const path = await this.files.openFile({ title: t.open, filters: [{ name: t.pngFilter, extensions: ["png"] }], directory: this.directory, fileName: null });
    if (!path) return;
    this.directory = folderOf(path);
    try {
      const png = await readFile(path);
      const decoded = decodeRgbaPng(png);
      this.images[i] = { path, png, source: decoded };
      this.sourcesVersion++;
      this.pickedColor = null;
      this.replan();
    } catch (e) {
      await showError(errorText(e));
    }
  }

  private clearImage(i: number): void {
    this.images[i] = null;
    this.sourcesVersion++;
    this.replan();
  }

  /** 開いた画像（間を詰めて下から順）。 */
  private get opened(): OpenedImage[] {
    return this.images.filter((x): x is OpenedImage => x !== null);
  }

  private transparentValue(): number | null | undefined {
    const mode = this.transparentMode.selectedIndex;
    if (mode === 2) return null;
    if (mode === 1 && this.pickedColor !== null) return this.pickedColor;
    return undefined;
  }

  /** プレビューを押したところの色を透明色にする。 */
  private pickTransparent(e: PointerEvent): void {
    const first = this.opened[0];
    if (!first) return;
    const p = pointIn(this.preview, e);
    const x = Math.floor(p.x / this.previewScale);
    const y = Math.floor(p.y / this.previewScale);
    if (x < 0 || y < 0 || x >= first.source.width || y >= first.source.height) return;
    const c = rgbaToColor(first.source.rgba, (y * first.source.width + x) * 4);
    if (c === TRANSPARENT) return;
    this.pickedColor = c;
    this.transparentMode.selectedIndex = 1;
    this.replan();
  }

  // ---- 計画 ----

  private tableOf(secondary: boolean): ImportTable {
    const data = secondary ? this.model.secondary : this.model.primary;
    const blocks = this.model.blockData(secondary);
    return { tiles: this.model.tilesOf(secondary), palettes: Uint16Array.from(data?.palettes ?? new Array<number>(256).fill(0)), blocks: blocks.blocks, attributes: blocks.attributes };
  }

  /** メインから使用回数などをもらう（写しが変わったときだけ）。 */
  private async ensureContext(): Promise<void> {
    if (this.context && this.contextVersion === this.client.snapshot.version) return;
    this.context = (await this.client.request({ op: "importContext" })) as ImportContextData;
    this.contextVersion = this.client.snapshot.version;
    this.others = this.context.otherSecondaryBlocks.map((b) => {
      const bytes = decodeBase64(b);
      const out = new Uint16Array(bytes.length >> 1);
      for (let i = 0; i < out.length; i++) out[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
      return out;
    });
  }

  /** 計画を作り直す（Worker へ送る。古い返事は捨てる）。 */
  private replan(): void {
    const seq = ++this.seq;
    const opened = this.opened;
    if (opened.length === 0) {
      this.plan = null;
      this.layers = null;
      this.planError = null;
      this.computing = false;
      this.render();
      return;
    }
    this.computing = true;
    this.render();
    void (async () => {
      try {
        await this.ensureContext();
      } catch (e) {
        this.planError = errorText(e);
        this.computing = false;
        this.render();
        return;
      }
      if (seq !== this.seq) return;
      const worker = this.planWorker();
      const sendSources = this.sentSources !== this.sourcesVersion;
      this.sentSources = this.sourcesVersion;
      const req: PlanRequest = {
        seq,
        sources: sendSources ? opened.map((o) => o.source) : null,
        transparent: this.transparentValue(),
        target: targetOf(IMPORT_TARGETS[this.target.selectedIndex] ?? "secondary"),
        primary: this.tableOf(false),
        secondary: this.tableOf(true),
        counts: this.context!.counts,
        otherSecondaryBlocks: this.others,
        options: { ...this.options, excludedPalettes: [...(this.options.excludedPalettes ?? [])], placement: [...(this.options.placement ?? [])] },
      };
      worker.postMessage(req);
    })();
  }

  private planWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./planWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<PlanResponse>) => {
      const r = e.data;
      if (r.seq !== this.seq) return;
      this.computing = false;
      if (r.ok) {
        this.plan = r.plan;
        this.layers = r.layers;
        this.planError = null;
      } else {
        this.plan = null;
        this.layers = null;
        this.planError = r.error;
      }
      this.render();
    };
    this.worker = w;
    return w;
  }

  /** 計算が終わるまで待つ（自動操作の `tileImport.wait` と「次へ」）。 */
  async waitPlan(timeout = 30000): Promise<unknown> {
    const end = performance.now() + timeout;
    while (this.computing && performance.now() < end) await new Promise((r) => setTimeout(r, 20));
    return this.describe();
  }

  // ---- 取り込む ----

  private async run(): Promise<void> {
    if (this.page !== PAGES - 1) return;
    await this.waitPlan();
    if (!this.plan?.ok) {
      this.showStatus(t.cannotNext);
      return;
    }
    const name = this.stampName.value.trim();
    try {
      const r = (await this.client.request({
        op: "importTiles",
        images: this.opened.map((o) => encodeBase64(o.png)),
        target: IMPORT_TARGETS[this.target.selectedIndex] ?? "secondary",
        transparent: this.transparentValue() ?? "auto",
        options: { ...this.options },
        stamp: this.stampCheck.checked && name !== "" ? name : null,
      })) as TileImportOutcome;
      if (!r.done) {
        this.showStatus(r.plan.problems.map((p) => t.problems[p.code]?.(p.params) ?? p.code).join(" / "));
        return;
      }
      this.options.placement = [];
      this.showStatus(t.done(r.plan.blocks.needed, r.plan.firstBlock, r.stamp));
    } catch (e) {
      await showError(errorText(e));
    }
  }

  private showStatus(text: string): void {
    this.status = text;
    this.statusLine.textContent = text;
  }

  // ---- 2. パレット ----

  private paletteRows: { use: HTMLInputElement; name: HTMLElement; state: HTMLElement; colors: HTMLCanvasElement; tiles: HTMLElement; index: number }[] = [];
  private reduceCheck!: HTMLInputElement;
  private reduceInfo!: HTMLElement;
  private before!: HTMLCanvasElement;
  private after!: HTMLCanvasElement;

  private palettePage(): PageParts {
    const p = this.pageRoot();
    const head = label(t.paletteHead, 0, 0, 500);
    head.classList.add("ti-heading");
    p.append(head);
    for (let r = 0; r < PRIMARY_PALETTE_COUNT; r++) {
      const y = 22 + r * 24;
      const use = check(`ti.pal.use.${r}`, "", 0, y + 2, 20);
      const name = autoId(label("", 22, y + 3, 80), `ti.pal.name.${r}`);
      const colors = pixelCanvas(`ti.pal.colors.${r}`, 16, 1, 12);
      place(colors, 100, y, 192, 12);
      colors.style.height = "18px";
      this.canvases.push(colors);
      const state = autoId(label("", 300, y + 3, 190), `ti.pal.state.${r}`);
      const tiles = autoId(label("", 492, y + 3, 80), `ti.pal.tiles.${r}`);
      const row = { use: use.input, name, state, colors, tiles, index: -1 };
      use.input.addEventListener("change", () => {
        const set = new Set(this.options.excludedPalettes);
        if (use.input.checked) set.delete(row.index);
        else set.add(row.index);
        this.options.excludedPalettes = [...set].sort((a, b) => a - b);
        this.replan();
      });
      this.paletteRows.push(row);
      p.append(use.root, name, colors, state, tiles);
    }
    const reduce = check("ti.reduce", t.reduce, 0, 198, 200);
    this.reduceCheck = reduce.input;
    this.reduceCheck.addEventListener("change", () => {
      this.options.reduce = this.reduceCheck.checked;
      this.replan();
    });
    this.reduceInfo = autoId(label("", 210, 199, 570), "ti.reduceInfo");
    this.before = pixelCanvas("ti.before", 16, 16, 1);
    this.after = pixelCanvas("ti.after", 16, 16, 1);
    this.canvases.push(this.before, this.after);
    const bFrame = place(document.createElement("div"), 0, 240, 386, 132);
    const aFrame = place(document.createElement("div"), 398, 240, 386, 132);
    bFrame.className += " ti-frame";
    aFrame.className += " ti-frame";
    bFrame.append(this.before);
    aFrame.append(this.after);
    p.append(reduce.root, this.reduceInfo, label(t.before, 0, 222), label(t.after, 398, 222), bFrame, aFrame);
    return { root: p, render: () => this.renderPalettePage() };
  }

  private renderPalettePage(): void {
    const secondary = this.targetSecondary();
    const first = secondary ? PRIMARY_PALETTE_COUNT : 0;
    const count = secondary ? TOTAL_PALETTE_COUNT - PRIMARY_PALETTE_COUNT : PRIMARY_PALETTE_COUNT;
    const plan = this.plan;
    const isNew = this.targetIsNew();
    this.paletteRows.forEach((row, r) => {
      const visible = r < count;
      for (const el of [row.use.parentElement!, row.name, row.state, row.colors, row.tiles]) el.hidden = !visible;
      if (!visible) return;
      const index = first + r;
      row.index = index;
      row.name.textContent = t.paletteName(index);
      const excluded = this.options.excludedPalettes?.includes(index) ?? false;
      row.use.checked = !excluded;
      const pal = plan?.palettes;
      const opened = pal?.opened.includes(index) ?? false;
      const used = !isNew && (pal?.usedSlots.includes(index) ?? false);
      row.state.textContent = excluded ? t.paletteStates.excluded : opened ? t.paletteStates.opened : pal?.fixedUsed.includes(index) ? t.paletteStates.reused : used ? t.paletteStates.used : t.paletteStates.free;
      row.tiles.textContent = t.paletteTiles(pal?.tileCounts[index] ?? 0);
      const colors = opened && plan?.result ? [...plan.result.palettes.subarray(index * 16, index * 16 + 16)] : isNew ? new Array<number>(16).fill(0) : this.model.committedColors(index);
      const rgba = new Uint8ClampedArray(16 * 4);
      colors.forEach((c, i) => writeBgr555(rgba, i, c));
      putRgba(row.colors, rgba);
    });
    this.reduceCheck.checked = this.options.reduce ?? false;
    const red = plan?.reduction;
    this.reduceInfo.textContent = red ? t.reduceInfo(red.changedPixels, red.colorsBefore, red.colorsAfter) : t.reduceNone;
    if (this.layers) {
      this.drawLayers(this.before, this.layers.layers, this.layers.width, this.layers.height, 386, 132);
      this.drawLayers(this.after, plan?.reducedLayers ?? this.layers.layers, this.layers.width, this.layers.height, 386, 132);
    }
  }

  // ---- 3. 作り方 ----

  private methodChecks: Record<string, HTMLInputElement> = {};
  private mode!: HTMLSelectElement;
  private modeRow!: HTMLElement;
  private upperBehind!: HTMLElement;
  private tripleNote!: HTMLElement;
  private baseEdit!: HTMLInputElement;
  /** #445 の部品を足す面。 */
  private methodExtra!: HTMLElement;
  private basePicker!: HTMLButtonElement;
  private methodPreview!: HTMLCanvasElement;

  private methodPage(): PageParts {
    const p = this.pageRoot();
    const items: [keyof ImportOptionsJson, string, string][] = [
      ["useFlip", "ti.useFlip", t.useFlip],
      ["reuseExisting", "ti.reuse", t.reuse],
      ["skipEmpty", "ti.skipEmpty", t.skipEmpty],
      ["mergeSame", "ti.mergeSame", t.mergeSame],
      ["reserveDoorTiles", "ti.reserveDoor", t.reserveDoor],
    ];
    items.forEach(([key, id, text], i) => {
      const c = check(id, text, 0, i * 22, 480);
      c.input.addEventListener("change", () => {
        (this.options as Record<string, unknown>)[key] = c.input.checked;
        this.replan();
      });
      this.methodChecks[key] = c.input;
      p.append(c.root);
    });
    this.modeRow = label(t.mode, 0, 124, 120);
    this.mode = combo("ti.mode", [...t.modeNames], 120, 121, 360);
    this.mode.addEventListener("change", () => {
      this.options.mode = (["picture", "under", "over"] as const)[this.mode.selectedIndex] ?? "picture";
      this.replan();
    });
    const ub = check("ti.upperBehind", t.upperBehind, 0, 124, 480);
    ub.input.addEventListener("change", () => {
      this.options.upperBehind = ub.input.checked;
      this.replan();
    });
    this.methodChecks["upperBehind"] = ub.input;
    this.upperBehind = ub.root;
    this.tripleNote = label(t.tripleNote, 0, 124, 780);
    this.baseEdit = edit("ti.base", 120, 148, 60);
    this.baseEdit.addEventListener("change", () => {
      const v = this.baseEdit.value.trim();
      this.options.baseBlock = v === "" ? null : parseInt(v, 16);
      if (this.options.baseBlock !== null && !Number.isFinite(this.options.baseBlock)) this.options.baseBlock = null;
      this.replan();
    });
    const hint = label(t.baseHint, 0, 174, 780);
    hint.classList.add("ti-note");
    this.methodExtra = place(document.createElement("div"), 0, 196, 784, 176);
    this.basePicker = button("ti.pickBase", t.pickBase, 192, 148, 90, 22, () => void (async () => {
      const chosen = await pickBaseBlock(this.model, this.options.baseBlock ?? null, this.targetSecondary());
      if (chosen !== undefined) { this.options.baseBlock = chosen; this.replan(); }
    })());
    this.methodPreview = pixelCanvas("ti.methodPreview", 96, 32, 3);
    this.canvases.push(this.methodPreview);
    this.methodExtra.append(label(t.sample, 0, 0, 780), place(this.methodPreview, 0, 26));
    p.append(this.basePicker, this.modeRow, this.mode, this.upperBehind, this.tripleNote, label(t.base, 0, 151, 120), this.baseEdit, hint, this.methodExtra);
    return { root: p, render: () => this.renderMethodPage() };
  }

  private renderMethodPage(): void {
    for (const [key, input] of Object.entries(this.methodChecks)) input.checked = (this.options as Record<string, unknown>)[key] === true;
    const n = Math.max(1, this.opened.length);
    this.modeRow.hidden = this.mode.hidden = n !== 1;
    this.upperBehind.hidden = n !== 2;
    this.tripleNote.hidden = n !== 3;
    this.mode.selectedIndex = ["picture", "under", "over"].indexOf(this.options.mode ?? "picture");
    this.methodChecks["reserveDoorTiles"]!.parentElement!.hidden = !this.targetSecondary();
    const base = this.options.baseBlock;
    if (document.activeElement !== this.baseEdit) this.baseEdit.value = base === null || base === undefined ? "" : formatHex(base, 3).replace(/^0x/i, "");
    this.baseEdit.disabled = this.basePicker.disabled = n !== 1 || this.options.mode === "picture";
    const rgba = new Uint8ClampedArray(96 * 32 * 4);
    for (let i = 0; i < 96 * 32; i++) rgba.set([220, 220, 220, 255], i * 4);
    const refs = base === null || base === undefined ? null : this.model.blockTiles(base);
    const drawBase = (x: number): void => { if (refs) for (let k = 0; k < 4; k++) this.model.drawTileRef(rgba, 96, refs[k]!, x + (k & 1) * 8, 8 + (k >> 1) * 8, false); };
    const drawImage = (x: number): void => {
      const layers = this.layers;
      if (!layers) return;
      for (let y = 0; y < Math.min(16, layers.height); y++) for (let px = 0; px < Math.min(16, layers.width); px++) {
        const c = (this.plan?.reducedLayers ?? layers.layers)[0]?.[y * layers.width + px];
        if (c !== undefined && c !== TRANSPARENT) writeBgr555(rgba, (y + 8) * 96 + x + px, c);
      }
    };
    if (this.options.mode !== "picture") { drawBase(8); drawBase(72); }
    drawImage(40);
    const drawPerson = (): void => {
      for (let y = 5; y < 24; y++) for (let x = 76; x < 84; x++) rgba.set(y < 11 ? [240, 184, 128, 255] : [40, 90, 200, 255], (y * 96 + x) * 4);
    };
    if (this.options.mode === "over") { drawPerson(); drawImage(72); } else { drawImage(72); drawPerson(); }
    putRgba(this.methodPreview, rgba);
  }

  // ---- 4. 置き場所 ----

  private placement!: PlacePage;

  private placePage(): PageParts {
    this.placement = new PlacePage(this.options, () => this.replan(), (block) => this.targetIsNew() ? 0 : this.context?.counts[block] ?? 0);
    return { root: this.placement.root, render: () => this.placement.render(this.plan, this.layers, this.model) };
  }

  // ---- 5. 確認 ----

  private summary!: HTMLTextAreaElement;
  private stampCheck!: HTMLInputElement;
  private stampName!: HTMLInputElement;

  private confirmPage(): PageParts {
    const p = this.pageRoot();
    this.summary = autoId(place(document.createElement("textarea"), 0, 0, 784, 300), "ti.summary") as HTMLTextAreaElement;
    this.summary.readOnly = true;
    this.summary.className += " ti-memo";
    const stamp = check("ti.stamp", t.stamp, 0, 312, 300);
    this.stampCheck = stamp.input;
    this.stampCheck.checked = true;
    this.stampName = edit("ti.stampName", 120, 340, 300);
    p.append(this.summary, stamp.root, label(t.stampName, 0, 343, 120), this.stampName);
    return { root: p, render: () => this.renderConfirmPage() };
  }

  private renderConfirmPage(): void {
    const plan = this.plan;
    const first = this.opened[0];
    if (first && this.stampName.value === "") this.stampName.value = t.stampDefault(fileNameOf(first.path).replace(/\.[^.]+$/, ""));
    if (!plan) {
      this.summary.value = "";
      return;
    }
    const placed = [...plan.locals].filter((l) => l >= 0).map((l) => plan.table.base + l);
    this.summary.value = t.summary({
      target: t.targetNames[this.target.selectedIndex] ?? "",
      palettes: plan.result?.changedPalettes ?? plan.palettes.opened,
      tiles: plan.tiles.created,
      blocksFrom: placed.length > 0 ? Math.min(...placed) : null,
      blocksTo: placed.length > 0 ? Math.max(...placed) : null,
      blocks: plan.blocks.needed,
      replaced: plan.blocks.replaced,
      reduced: plan.reduction?.changedPixels ?? null,
    });
  }

  // ---- 描画 ----

  private targetSecondary(): boolean {
    return targetOf(IMPORT_TARGETS[this.target.selectedIndex] ?? "secondary").secondary;
  }

  private targetIsNew(): boolean {
    return targetOf(IMPORT_TARGETS[this.target.selectedIndex] ?? "secondary").isNew;
  }

  private render(): void {
    this.pages[this.page]?.render();
    this.renderMeters();
    this.renderProblems();
    const busy = this.computing;
    this.backButton.disabled = this.page === 0;
    this.nextButton.disabled = this.page === PAGES - 1 || busy;
    this.runButton.disabled = this.page !== PAGES - 1 || busy || !this.plan?.ok;
    this.statusLine.textContent = busy ? t.computing : this.status;
  }

  private renderImagePage(): void {
    this.images.forEach((img, i) => (this.fileLabels[i]!.textContent = img ? img.path : t.noFile));
    const c = this.pickedColor;
    this.swatch.style.background = c === null ? "transparent" : `rgb(${(c & 31) * 8},${((c >> 5) & 31) * 8},${((c >> 10) & 31) * 8})`;
    const l = this.layers;
    if (!l) {
      this.imageInfo.textContent = this.planError ?? t.noImage;
      resizePixelCanvas(this.preview, 1, 1, 1);
      return;
    }
    this.previewScale = this.drawLayers(this.preview, l.layers, l.width, l.height, 500, 206);
    const colors = this.plan?.palettes.colorCount ?? 0;
    this.imageInfo.textContent = `${t.imageInfo(l.sourceWidth, l.sourceHeight, (l.width / 16) * (l.height / 16), colors, l.padded)}\n${t.layersNote(l.layers.length)}`;
  }

  /** 色の面を重ねて描く（透明は市松）。枠に収まる倍率を返す。 */
  private drawLayers(canvas: HTMLCanvasElement, layers: readonly Uint16Array[], width: number, height: number, boxW: number, boxH: number): number {
    const fit = Math.min(boxW / width, boxH / height);
    const scale = fit >= 1 ? Math.max(1, Math.min(4, Math.floor(fit))) : fit;
    resizePixelCanvas(canvas, width, height, scale);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      let c = TRANSPARENT;
      for (const l of layers) if (l[i] !== TRANSPARENT) c = l[i]!;
      if (c === TRANSPARENT) {
        const x = i % width;
        const y = Math.floor(i / width);
        const v = ((x >> 2) + (y >> 2)) & 1 ? 0xcc : 0xff;
        rgba.set([v, v, v, 255], i * 4);
      } else writeBgr555(rgba, i, c);
    }
    putRgba(canvas, rgba);
    return scale;
  }

  private renderMeters(): void {
    const plan = this.plan;
    const values = plan ? [plan.tiles, plan.blocks, plan.palettes] : [null, null, null];
    values.forEach((m, i) => {
      const meter = this.meters[i]!;
      if (!m) {
        meter.text.textContent = "-";
        meter.bar.style.width = "0";
        meter.root.classList.remove("ti-meter-short");
        return;
      }
      meter.text.textContent = t.meter(m.needed, m.free, m.capacity);
      meter.bar.style.width = `${Math.min(100, m.free > 0 ? (m.needed / m.free) * 100 : m.needed > 0 ? 100 : 0)}%`;
      meter.root.classList.toggle("ti-meter-short", m.needed > m.free);
    });
  }

  private renderProblems(): void {
    const list = this.problemList;
    list.replaceChildren();
    const add = (mark: string, text: string, error: boolean): void => {
      const line = document.createElement("div");
      line.className = error ? "ti-problem-error" : "ti-problem-note";
      line.textContent = `${mark} ${text}`;
      list.append(line);
    };
    if (this.planError) add(t.problemMark.error, this.planError, true);
    for (const p of this.plan?.problems ?? []) add(t.problemMark[p.level], t.problems[p.code]?.(p.params) ?? p.code, p.level === "error");
  }

  // ---- 自動操作と後始末 ----

  private describe(): unknown {
    const plan = this.plan;
    return {
      page: this.page,
      files: this.images.map((i) => i?.path ?? null),
      target: IMPORT_TARGETS[this.target.selectedIndex] ?? null,
      transparent: this.transparentValue() ?? null,
      options: this.options,
      computing: this.computing,
      error: this.planError,
      status: this.status,
      plan: plan
        ? {
            ok: plan.ok,
            paletteShortage: plan.paletteShortage,
            problems: plan.problems.map((p) => p.code),
            tiles: plan.tiles,
            blocks: plan.blocks,
            palettes: { needed: plan.palettes.needed, free: plan.palettes.free, capacity: plan.palettes.capacity, opened: plan.palettes.opened, fixedUsed: plan.palettes.fixedUsed },
            reduction: plan.reduction,
            locals: [...plan.locals],
            cells: [...plan.stampCells],
            firstBlock: plan.firstBlock,
          }
        : null,
    };
  }

  /** 閉じるとき、画像・Canvas・Worker を返す（#429 と同じく Canvas を 0×0 にする）。 */
  private dispose(): void {
    this.placement.dispose();
    this.worker?.terminate();
    this.worker = null;
    for (const c of this.canvases) {
      c.width = 0;
      c.height = 0;
    }
    this.images.fill(null);
    this.plan = null;
    this.layers = null;
    this.root.replaceChildren();
  }

}
