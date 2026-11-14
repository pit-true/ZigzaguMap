import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PART_ROLES, decodeBase64, slotNamesOf, type AutoPenPart, type PartCell, type PartGrid, type PartKind, type PartRole } from "@zigzagumap/core";
import { jaAssist as t } from "../../i18n/ja.assist";
import { jaPen } from "../../i18n/ja.pen";
import { errorText } from "../../util/errors";
import { startToolWindowAutomation } from "../world-map/toolWindowAutomation";
import "../../styles/mapAssist.css";
import { MAP_ASSIST_MESSAGE_EVENT, MAP_ASSIST_REQUEST_EVENT, type AssistData, type AssistImage, type AssistMessage, type AssistRange, type AssistRequest } from "./protocol";

/** ブロック 1 つの画素。 */
const BLOCK = 16;
/** パレットの 1 行のブロック数。 */
const PALETTE_WIDTH = 8;
/** 主タイルセットのブロック数。 */
const PRIMARY = 640;

type RequestBody = AssistRequest extends infer R ? (R extends AssistRequest ? Omit<R, "id"> : never) : never;

/** 左で選んだ所（枠に入れる並び）。 */
interface Picked {
  readonly x: number;
  readonly y: number;
  readonly grid: PartGrid;
}

/**
 * マップ作成補助（別ウィンドウ。#312）。左の「ブロック一覧」「マップ」で範囲を選び、中のパーツの一覧で選んだパーツの、
 * 右の枠に「← 左で選んだ所を入れる」で入れる。「保存」で maps\autopen へすぐ書く（元に戻すの対象にしない）。
 * 「選んだパーツで範囲を塗る」「範囲を整える」は、メインで Ctrl＋右ドラッグで選んだ範囲を 1 回の操作で書く。
 * 「マップから候補を作る（自動）」（#313）は、主タイルセットが同じ全マップから候補を作って一覧に足す（保存はしない）。
 */
export class MapAssistWindow {
  private data: AssistData | null = null;
  private parts: AutoPenPart[] = [];
  private dirty = false;
  private selectedPart = -1;
  private selectedSlot = "";
  private tab: "blocks" | "map" = "blocks";
  private picked: Picked | null = null;
  private atlas: HTMLCanvasElement | null = null;
  private mapAtlas: HTMLCanvasElement | null = null;
  private dragFrom: { x: number; y: number } | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // 部品
  private readonly sourceCanvas = canvasEl("assist.source");
  private readonly sourceBox = div("assist-source-box");
  private readonly selectionLabel = div("assist-note");
  private readonly tabBlocks = buttonEl("assist.tabBlocks", t.tabBlocks, () => this.setTab("blocks"));
  private readonly tabMap = buttonEl("assist.tabMap", t.tabMap, () => this.setTab("map"));
  private readonly list = document.createElement("select");
  private readonly nameInput = document.createElement("input");
  private readonly roleSelect = document.createElement("select");
  private readonly slotBox = div("assist-slots");
  private readonly status = div("assist-status");
  private readonly rangeLabel = div("assist-note");
  private readonly tidyEdges = checkbox("assist.tidyEdges", true);
  private readonly tidyRepeats = checkbox("assist.tidyRepeats", true);
  private readonly tidyMovement = checkbox("assist.tidyMovement", false);

  constructor(private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    this.build();
    await getCurrentWebviewWindow().listen<AssistMessage>(MAP_ASSIST_MESSAGE_EVENT, (e) => this.onMessage(e.payload));
    const data = (await this.request({ op: "hello" })) as AssistData | null;
    if (data) this.setData(data);
    await startToolWindowAutomation({
      describe: () => this.describe(),
      canvas: (id) => (id === "assist.source" ? this.sourceCanvas.toDataURL("image/png") : null),
    });
  }

  // ---- やり取り ----

  private request(body: RequestBody): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      emitTo("main", MAP_ASSIST_REQUEST_EVENT, { ...body, id }).catch((e: unknown) => {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  private onMessage(m: AssistMessage): void {
    if (m.type === "reply") {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error ?? ""));
    } else if (m.type === "data") this.setData(m.data);
    else this.setRange(m.range);
  }

  private setData(data: AssistData): void {
    const changed = this.data?.key !== data.key;
    this.data = data;
    this.atlas = imageCanvas(data.palette);
    if (changed || !this.dirty) {
      this.parts = data.parts.map(clonePart);
      this.dirty = data.unsaved;
      this.selectedPart = this.parts.length > 0 ? Math.min(Math.max(this.selectedPart, 0), this.parts.length - 1) : -1;
      this.picked = null;
    }
    if (changed) this.mapAtlas = null;
    document.title = `${t.title} - ${data.mapName}`;
    this.setRange(data.range);
    this.renderSource();
    this.renderList();
  }

  private setRange(range: AssistRange | null): void {
    if (this.data) this.data = { ...this.data, range };
    this.rangeLabel.textContent = range ? t.rangeOf(range.x, range.y, range.width, range.height) : t.rangeNone;
  }

  private say(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle("error", error);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e) {
      this.say(t.error(errorText(e)), true);
    }
  }

  // ---- 画面 ----

  private build(): void {
    this.root.classList.add("map-assist");
    // 左
    const left = div("assist-left");
    const tabs = div("assist-tabs");
    tabs.append(this.tabBlocks, this.tabMap);
    this.sourceBox.append(this.sourceCanvas);
    left.append(tabs, this.sourceBox, this.selectionLabel);
    this.sourceCanvas.addEventListener("pointerdown", (e) => this.pointer(e, "down"));
    this.sourceCanvas.addEventListener("pointermove", (e) => this.pointer(e, "move"));
    this.sourceCanvas.addEventListener("pointerup", (e) => this.pointer(e, "up"));

    // 中
    const mid = div("assist-mid");
    this.list.size = 14;
    this.list.dataset["autoId"] = "assist.parts";
    this.list.addEventListener("change", () => {
      this.selectedPart = this.list.selectedIndex;
      this.selectedSlot = "";
      this.renderList();
    });
    const adds = div("assist-row");
    const kinds: [PartKind, string][] = [
      ["fill", t.addFill],
      ["edge", t.addEdge],
      ["piece", t.addPiece],
      ["repeat", t.addRepeat],
    ];
    for (const [kind, label] of kinds) adds.append(buttonEl(`assist.add.${kind}`, label, () => this.addPart(kind)));
    const ops = div("assist-row");
    ops.append(buttonEl("assist.remove", t.remove, () => this.removePart()), buttonEl("assist.up", t.up, () => this.movePart(-1)), buttonEl("assist.down", t.down, () => this.movePart(1)));
    this.nameInput.dataset["autoId"] = "assist.name";
    this.nameInput.addEventListener("change", () => this.editPart({ name: this.nameInput.value.trim() || this.current()!.name }));
    this.roleSelect.dataset["autoId"] = "assist.role";
    for (const r of PART_ROLES) {
      const o = document.createElement("option");
      o.value = r;
      o.textContent = jaPen.roles[r] ?? r;
      this.roleSelect.append(o);
    }
    this.roleSelect.addEventListener("change", () => this.editPart({ role: this.roleSelect.value as PartRole }));
    const nameRow = div("assist-row");
    nameRow.append(labelEl(t.name), this.nameInput);
    const roleRow = div("assist-row");
    roleRow.append(labelEl(t.role), this.roleSelect);
    const tools = div("assist-col");
    tools.append(buttonEl("assist.analyze", t.analyze, () => void this.run(() => this.analyze())), buttonEl("assist.importBochi", t.importBochi, () => void this.run(() => this.importBochi())));
    mid.append(labelEl(t.parts), this.list, adds, ops, nameRow, roleRow, tools);

    // 右
    const right = div("assist-right");
    const slotOps = div("assist-row");
    slotOps.append(buttonEl("assist.put", t.putSelection, () => this.putSelection()), buttonEl("assist.clearSlot", t.clearSlot, () => this.setSlot(null)));
    const saveRow = div("assist-row");
    saveRow.append(buttonEl("assist.save", t.save, () => void this.run(() => this.save())));
    const range = div("assist-range");
    const tidyRow = div("assist-row");
    tidyRow.append(withLabel(this.tidyEdges, t.tidyEdges), withLabel(this.tidyRepeats, t.tidyRepeats), withLabel(this.tidyMovement, t.tidyMovement));
    range.append(
      labelEl(t.rangeTitle),
      this.rangeLabel,
      buttonEl("assist.fill", t.fillRange, () => void this.run(() => this.fill())),
      tidyRow,
      buttonEl("assist.tidy", t.tidyRange, () => void this.run(() => this.tidy())),
    );
    right.append(labelEl(t.slots), this.slotBox, slotOps, saveRow, range);

    const body = div("assist-body");
    body.append(left, mid, right);
    this.root.append(body, this.status);
    this.setTab("blocks");
  }

  private setTab(tab: "blocks" | "map"): void {
    this.tab = tab;
    this.picked = null;
    this.tabBlocks.classList.toggle("active", tab === "blocks");
    this.tabMap.classList.toggle("active", tab === "map");
    if (tab === "map" && !this.mapAtlas) {
      void this.run(async () => {
        this.mapAtlas = imageCanvas((await this.request({ op: "mapImage" })) as AssistImage);
        this.renderSource();
      });
    }
    this.renderSource();
  }

  private renderSource(): void {
    const src = this.tab === "blocks" ? this.atlas : this.mapAtlas;
    const c = this.sourceCanvas;
    if (!src) {
      c.width = c.height = 0;
      return;
    }
    const zoom = this.tab === "blocks" ? 2 : 1;
    c.width = src.width * zoom;
    c.height = src.height * zoom;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    const p = this.picked;
    if (p) {
      const s = BLOCK * zoom;
      g.strokeStyle = "#ff0000";
      g.lineWidth = 2;
      g.strokeRect(p.x * s + 1, p.y * s + 1, p.grid.width * s - 2, p.grid.height * s - 2);
    }
    this.selectionLabel.textContent = p ? t.selection(p.x, p.y, p.grid.width, p.grid.height) : t.noSelection;
  }

  /** 左の画像の上のドラッグで範囲を選ぶ。 */
  private pointer(e: PointerEvent, type: "down" | "move" | "up"): void {
    const zoom = this.tab === "blocks" ? 2 : 1;
    const r = this.sourceCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (BLOCK * zoom));
    const y = Math.floor((e.clientY - r.top) / (BLOCK * zoom));
    if (type === "down") {
      this.dragFrom = { x, y };
      try {
        this.sourceCanvas.setPointerCapture(e.pointerId);
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
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.tab === "blocks") {
          const block = paletteBlock(x, y, data.secondaryCount);
          cells.push(block === null ? null : { block, movement: null });
        } else {
          const v = x < data.map.width && y < data.map.height ? data.map.cells[y * data.map.width + x] : undefined;
          cells.push(v === undefined ? null : { block: v & 0x3ff, movement: v >> 10 });
        }
      }
    }
    this.picked = { x: x0, y: y0, grid: { width: x1 - x0 + 1, height: y1 - y0 + 1, cells } };
    this.renderSource();
  }

  private current(): AutoPenPart | null {
    return this.parts[this.selectedPart] ?? null;
  }

  private renderList(): void {
    const keep = this.selectedPart;
    this.list.replaceChildren(
      ...this.parts.map((p) => {
        const o = document.createElement("option");
        o.textContent = `${p.name}（${jaPen.kinds[p.kind] ?? p.kind}）`;
        return o;
      }),
    );
    this.list.selectedIndex = keep;
    const part = this.current();
    this.nameInput.value = part?.name ?? "";
    this.roleSelect.value = part?.role ?? "other";
    this.nameInput.disabled = this.roleSelect.disabled = !part;
    this.renderSlots();
    if (this.dirty) this.say(t.unsaved);
  }

  private renderSlots(): void {
    const part = this.current();
    this.slotBox.replaceChildren();
    if (!part) return;
    this.slotBox.dataset["kind"] = part.kind;
    for (const name of slotNamesOf(part.kind)) {
      const cell = div("assist-slot");
      cell.dataset["autoId"] = `assist.slot.${name}`;
      cell.classList.toggle("selected", name === this.selectedSlot);
      const g = part.slots[name];
      const c = document.createElement("canvas");
      const w = Math.max(1, Math.min(g?.width ?? 1, 6));
      const h = Math.max(1, Math.min(g?.height ?? 1, 6));
      c.width = w * BLOCK;
      c.height = h * BLOCK;
      if (g && this.atlas) {
        const ctx = c.getContext("2d")!;
        g.cells.forEach((pc, i) => {
          const x = i % g.width;
          const y = Math.floor(i / g.width);
          if (!pc || x >= w || y >= h) return;
          const p = palettePos(pc.block);
          ctx.drawImage(this.atlas!, p.col * BLOCK, p.row * BLOCK, BLOCK, BLOCK, x * BLOCK, y * BLOCK, BLOCK, BLOCK);
        });
      }
      const caption = div("assist-slot-name");
      caption.textContent = g ? `${name} ${g.width}×${g.height}` : `${name} ${t.slotEmpty}`;
      cell.append(caption, c);
      cell.addEventListener("click", () => {
        this.selectedSlot = name;
        this.renderSlots();
      });
      this.slotBox.append(cell);
    }
  }

  // ---- 編集（保存するまでウィンドウの中だけ） ----

  private touch(): void {
    this.dirty = true;
    this.renderList();
  }

  private addPart(kind: PartKind): void {
    const label = jaPen.kinds[kind] ?? kind;
    let n = 1;
    while (this.parts.some((p) => p.name === t.newName(label, n))) n++;
    this.parts.push({ name: t.newName(label, n), kind, role: kind === "edge" ? "water" : kind === "repeat" ? "tree" : kind === "piece" ? "building" : "ground", order: this.parts.length, slots: {} });
    this.selectedPart = this.parts.length - 1;
    this.selectedSlot = slotNamesOf(kind)[0] ?? "";
    this.touch();
  }

  private removePart(): void {
    if (!this.current()) return;
    this.parts.splice(this.selectedPart, 1);
    this.selectedPart = Math.min(this.selectedPart, this.parts.length - 1);
    this.touch();
  }

  private movePart(d: number): void {
    const i = this.selectedPart;
    const j = i + d;
    if (i < 0 || j < 0 || j >= this.parts.length) return;
    [this.parts[i], this.parts[j]] = [this.parts[j]!, this.parts[i]!];
    this.selectedPart = j;
    this.touch();
  }

  private editPart(patch: Partial<AutoPenPart>): void {
    const part = this.current();
    if (!part) return;
    this.parts[this.selectedPart] = { ...part, ...patch };
    this.touch();
  }

  private setSlot(grid: PartGrid | null): void {
    const part = this.current();
    if (!part || !this.selectedSlot) return this.say(t.noPart, true);
    const slots = { ...part.slots };
    if (grid) slots[this.selectedSlot] = grid;
    else delete slots[this.selectedSlot];
    this.parts[this.selectedPart] = { ...part, slots };
    this.touch();
  }

  private putSelection(): void {
    if (!this.picked) return this.say(t.noSelection, true);
    this.setSlot(this.picked.grid);
  }

  private async save(): Promise<void> {
    const parts = this.parts.map((p, order) => ({ ...p, order }));
    const r = (await this.request({ op: "save", parts })) as { written: string[] };
    this.dirty = false;
    this.say(t.saved(r.written.length));
  }

  private async analyze(): Promise<void> {
    this.say(t.analyzing);
    const r = (await this.request({ op: "analyze" })) as { parts: AutoPenPart[] };
    const names = new Set(this.parts.map((p) => p.name));
    const add = r.parts.filter((p) => !names.has(p.name)).map(clonePart);
    this.parts.push(...add);
    if (add.length > 0) this.dirty = true;
    this.renderList();
    this.say(t.analyzed(add.length));
  }

  private async importBochi(): Promise<void> {
    const r = (await this.request({ op: "importBochi" })) as { parts: number; matched: number } | null;
    if (r) this.say(t.imported(r.parts, r.matched));
  }

  private async fill(): Promise<void> {
    const part = this.current();
    if (!part) return this.say(t.noPart, true);
    const r = (await this.request({ op: "fill", part })) as { count: number };
    this.say(t.painted(r.count));
  }

  private async tidy(): Promise<void> {
    const options = { edges: this.tidyEdges.checked, repeats: this.tidyRepeats.checked, movement: this.tidyMovement.checked };
    const r = (await this.request({ op: "tidy", options })) as { count: number };
    this.say(t.painted(r.count));
  }

  /** 自動操作の `state`。 */
  private describe(): unknown {
    const part = this.current();
    return {
      tab: this.tab,
      parts: this.parts.map((p) => ({ name: p.name, kind: p.kind, role: p.role, slots: Object.keys(p.slots) })),
      selected: part?.name ?? null,
      slot: this.selectedSlot,
      picked: this.picked ? { x: this.picked.x, y: this.picked.y, width: this.picked.grid.width, height: this.picked.grid.height } : null,
      range: this.data?.range ?? null,
      dirty: this.dirty,
      status: this.status.textContent,
    };
  }
}

/** パレットの (列, 行) のブロック（無い位置は null）。 */
function paletteBlock(col: number, row: number, secondaryCount: number): number | null {
  if (col < 0 || col >= PALETTE_WIDTH || row < 0) return null;
  const primaryRows = PRIMARY / PALETTE_WIDTH;
  if (row < primaryRows) return row * PALETTE_WIDTH + col;
  const i = (row - primaryRows) * PALETTE_WIDTH + col;
  return i < secondaryCount ? PRIMARY + i : null;
}

function palettePos(block: number): { col: number; row: number } {
  if (block < PRIMARY) return { col: block % PALETTE_WIDTH, row: Math.floor(block / PALETTE_WIDTH) };
  const i = block - PRIMARY;
  return { col: i % PALETTE_WIDTH, row: PRIMARY / PALETTE_WIDTH + Math.floor(i / PALETTE_WIDTH) };
}

function imageCanvas(image: AssistImage): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const bytes = decodeBase64(image.rgba);
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(bytes), image.width, image.height), 0, 0);
  return c;
}

function clonePart(p: AutoPenPart): AutoPenPart {
  return JSON.parse(JSON.stringify(p)) as AutoPenPart;
}

function div(className: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

function canvasEl(id: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.dataset["autoId"] = id;
  return c;
}

function buttonEl(id: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.dataset["autoId"] = id;
  b.addEventListener("click", onClick);
  return b;
}

function labelEl(text: string): HTMLElement {
  const l = document.createElement("div");
  l.className = "assist-label";
  l.textContent = text;
  return l;
}

function checkbox(id: string, checked: boolean): HTMLInputElement {
  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = checked;
  c.dataset["autoId"] = id;
  return c;
}

function withLabel(input: HTMLInputElement, text: string): HTMLElement {
  const l = document.createElement("label");
  l.append(input, document.createTextNode(text));
  return l;
}
