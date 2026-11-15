import { PART_ROLES, slotNamesOf, type AutoPenPart, type PartGrid, type PartKind, type PartRole } from "@zigzagumap/core";
import { jaAssist as t } from "../../i18n/ja.assist";
import { jaPen } from "../../i18n/ja.pen";
import { errorText } from "../../util/errors";
import { startToolWindowAutomation } from "../world-map/toolWindowAutomation";
import "../../styles/mapAssist.css";
import { AssistSourcePane } from "./AssistSourcePane";
import { BLOCK, buttonEl, checkbox, div, labelEl, palettePos, withLabel } from "./assistDom";
import { MapAssistClient } from "./MapAssistClient";
import type { AssistData, AssistImage, AssistRange } from "./protocol";

/**
 * マップ作成補助（別ウィンドウ。#312）。左の「ブロック一覧」「マップ」で範囲を選び、中のパーツの一覧で選んだパーツの、
 * 右の枠に「← 左で選んだ所を入れる」で入れる。「保存」で maps\autopen へすぐ書く（元に戻すの対象にしない）。
 * 「選んだパーツで範囲を塗る」「範囲を整える」は、メインで Ctrl＋右ドラッグで選んだ範囲を 1 回の操作で書く。
 * 「マップから候補を作る（自動）」（#313）は、主タイルセットが同じ全マップから候補を作って一覧に足す（保存はしない）。
 *
 * 一覧の正本はメインに置く（#379）。窓の編集はすぐ画面に出し、同時に一覧を番号つきでメインへ送る。メインから届いた一覧は、
 * 窓が送った編集をメインが全部受け取ったあとのもの（`data.seq` が送った番号以上）なら、そのまま使う（窓の外の変更も入る）。
 */
export class MapAssistWindow {
  private data: AssistData | null = null;
  private parts: AutoPenPart[] = [];
  private dirty = false;
  /** 送った編集のいちばん新しい番号。 */
  private seq = 0;
  private selectedPart = -1;
  private selectedSlot = "";
  private readonly client = new MapAssistClient();

  // 部品
  /** 左の「ブロック一覧」「マップ」と、選んだ所。 */
  private readonly source = new AssistSourcePane({
    mapImage: async () => (await this.client.request({ op: "mapImage" })) as AssistImage,
    run: (action) => this.run(action),
  });
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
    await this.client.connect({ data: (data) => this.setData(data), range: (range) => this.setRange(range) });
    const data = (await this.client.request({ op: "hello" })) as AssistData | null;
    if (data) this.setData(data);
    await startToolWindowAutomation({
      describe: () => this.describe(),
      canvas: (id) => (id === "assist.source" ? this.source.canvas.toDataURL("image/png") : null),
    });
  }

  // ---- やり取り ----

  private setData(data: AssistData): void {
    const first = this.data === null;
    const changed = this.data?.key !== data.key;
    this.data = data;
    this.source.setData(data, changed, changed);
    // 送った編集がまだメインに届いていない間の一覧は古いので使わない（届いたあとに送り直してくる）
    if (data.seq >= this.seq) {
      this.parts = data.parts.map(clonePart);
      this.dirty = data.unsaved;
      this.selectedPart = this.parts.length > 0 ? Math.min(Math.max(this.selectedPart, 0), this.parts.length - 1) : -1;
    }
    document.title = `${t.title} - ${data.mapName}`;
    this.setRange(data.range);
    this.source.render();
    this.renderList();
    // 下の帯は、開いたときと組が変わったときだけ書き換える（読み込みなどの知らせを消さない）
    if (first || changed) this.say(this.dirty ? t.unsaved : "");
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
    body.append(this.source.element, mid, right);
    this.root.append(body, this.status);
    this.source.setTab("blocks");
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
      const atlas = this.source.atlas;
      if (g && atlas) {
        const ctx = c.getContext("2d")!;
        g.cells.forEach((pc, i) => {
          const x = i % g.width;
          const y = Math.floor(i / g.width);
          if (!pc || x >= w || y >= h) return;
          const p = palettePos(pc.block);
          ctx.drawImage(atlas, p.col * BLOCK, p.row * BLOCK, BLOCK, BLOCK, x * BLOCK, y * BLOCK, BLOCK, BLOCK);
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

  /** 編集した: 画面に出し、一覧をメインへ送る。 */
  private touch(): void {
    this.dirty = true;
    this.renderList();
    this.say(t.unsaved);
    const seq = ++this.seq;
    this.client.request({ op: "draft", seq, parts: this.ordered() }).catch((e: unknown) => this.say(t.error(errorText(e)), true));
  }

  /** 今の並びで order を付け直した一覧。 */
  private ordered(): AutoPenPart[] {
    return this.parts.map((p, order) => ({ ...p, order }));
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
    const picked = this.source.picked;
    if (!picked) return this.say(t.noSelection, true);
    this.setSlot(picked.grid);
  }

  private async save(): Promise<void> {
    const r = (await this.client.request({ op: "save", seq: this.seq, parts: this.ordered() })) as { written: string[] };
    this.dirty = false;
    this.say(t.saved(r.written.length));
  }

  /** 候補を作る。足すのはメイン（窓の編集中の一覧に足し、返事にその一覧を入れてくる）。 */
  private async analyze(): Promise<void> {
    this.say(t.analyzing);
    const r = (await this.client.request({ op: "analyze" })) as { added: number; data: AssistData | null };
    if (r.data) this.setData(r.data);
    this.say(t.analyzed(r.added));
  }

  /** Bochi の定義を読み込む。ファイルに書くのも、窓の編集中の一覧に足すのもメイン。 */
  private async importBochi(): Promise<void> {
    const r = (await this.client.request({ op: "importBochi" })) as { parts: number; matched: number; data: AssistData | null } | null;
    if (!r) return;
    if (r.data) this.setData(r.data);
    this.say(r.matched > 0 && this.dirty ? t.importedKeeping(r.parts) : t.imported(r.parts, r.matched));
  }

  private async fill(): Promise<void> {
    const part = this.current();
    if (!part) return this.say(t.noPart, true);
    const r = (await this.client.request({ op: "fill", part })) as { count: number };
    this.say(t.painted(r.count));
  }

  private async tidy(): Promise<void> {
    const options = { edges: this.tidyEdges.checked, repeats: this.tidyRepeats.checked, movement: this.tidyMovement.checked };
    const r = (await this.client.request({ op: "tidy", options })) as { count: number };
    this.say(t.painted(r.count));
  }

  /** 自動操作の `state`。 */
  private describe(): unknown {
    const part = this.current();
    const picked = this.source.picked;
    return {
      tab: this.source.tab,
      parts: this.parts.map((p) => ({ name: p.name, kind: p.kind, role: p.role, slots: Object.keys(p.slots) })),
      selected: part?.name ?? null,
      slot: this.selectedSlot,
      picked: picked ? { x: picked.x, y: picked.y, width: picked.grid.width, height: picked.grid.height, blocks: picked.grid.cells.map((c) => c?.block ?? null) } : null,
      range: this.data?.range ?? null,
      dirty: this.dirty,
      status: this.status.textContent,
    };
  }
}

function clonePart(p: AutoPenPart): AutoPenPart {
  return JSON.parse(JSON.stringify(p)) as AutoPenPart;
}
