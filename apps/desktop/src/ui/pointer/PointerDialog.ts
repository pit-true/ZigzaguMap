import {
  MapBankTable,
  Rom,
  findPointerRefsChunked,
  knownMapRanges,
  listMapPointers,
  rangeAt,
  toPointerValue,
  type KnownRange,
  type MapPointer,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { readFile, type FileDialogs } from "../../app/FileDialogs";
import { hex } from "../../i18n/ja";
import { jaPointers as t } from "../../i18n/ja.pointers";
import "../../styles/pointer.css";
import { showContextMenu } from "../ContextMenu";
import { createDialog, dialogButton, handleDialogKeys, type DialogFrame } from "../Dialog";

/** イベントの種類（一覧の行から選ぶイベント）。 */
type EventRef = { readonly kind: "person" | "sign" | "trap" | "warp"; readonly index: number };

/** 窓の外の機能（App が渡す）。 */
export interface PointerDialogHost {
  readonly state: EditorState;
  readonly files: FileDialogs;
  /** イベントタブでイベントを選ぶ（タブも切り替える）。 */
  selectEvent(kind: EventRef["kind"], index: number): void;
  /** イベントタブで選んでいるもの。 */
  eventSelection(): { kind: string; index: number } | null;
  /** テキストをクリップボードへ（自動操作では記録だけ）。 */
  copyText(text: string): void;
}

/** 参照元の検索の結果 1 件。 */
export interface PointerSearchHit {
  readonly offset: number;
  readonly place: string;
}

/** 最後の検索（自動操作の `pointers.state`）。 */
export interface PointerSearchResult {
  readonly value: number;
  readonly rom: string;
  readonly hits: readonly PointerSearchHit[];
  readonly ms: number;
  /** 小分けにした回数。 */
  readonly chunks: number;
}

/** 1 回に探す大きさ（4MB。手元の PC で数 ms なので、32MB でも画面は止まらない）。 */
const SEARCH_CHUNK = 4 << 20;

/**
 * ツール > ポインタ一覧と参照元の検索（Ctrl+Shift+P。#307。Bochi の MapPointerReport）。読むだけの調査の道具。
 * - 上: 今のマップのポインタ（置き場所・値・リトルエンディアンのバイト列）。行を押すとそのイベントを選び、イベントタブで選ぶと行も選ぶ。
 * - 下: アドレスを入れて、ROM 全体から 4 バイト境界のポインタ（0x08000000 を足した値）を探す。見つかった場所がマップの表の中なら名前も出す。
 *   探す ROM は開いているベース ROM か、ほかの ROM のファイル（ビルドした ROM など。読むだけで、探し終えたら捨てる）。
 * - 行の右クリックで値・バイト列・置き場所をクリップボードへ。
 */
export class PointerDialog {
  private frame: DialogFrame | null = null;
  private table: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  private resultBox: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private addressInput: HTMLInputElement | null = null;
  private romSelect: HTMLSelectElement | null = null;
  private pointers: MapPointer[] = [];
  private rows: HTMLElement[] = [];
  private otherRom: string | null = null;
  /** マップの表の名前の付いた範囲（ベース ROM の分。初めて探すときに作る）。 */
  private ranges: { rom: Rom; ranges: KnownRange[] } | null = null;
  private searching = 0;
  /** 最後の検索の結果。 */
  last: PointerSearchResult | null = null;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(private readonly host: PointerDialogHost) {}

  get isOpen(): boolean {
    return this.frame !== null;
  }

  /** 今の一覧（自動操作用）。 */
  get list(): readonly MapPointer[] {
    return this.pointers;
  }

  /** 選んでいる行の番号（無ければ -1）。 */
  get selectedRow(): number {
    return this.rows.findIndex((r) => r.classList.contains("selected"));
  }

  /** 開く（開いていれば手前に出して読み直す）。 */
  open(): void {
    if (!this.frame) this.build();
    this.refresh();
    this.addressInput?.focus();
  }

  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.table = null;
    this.rows = [];
    this.pointers = [];
    this.ranges = null;
    this.searching++;
    for (const u of this.unsubscribe.splice(0)) u();
  }

  /** 今のマップの一覧を作り直す。 */
  refresh(): void {
    const state = this.host.state;
    const session = state.session;
    const id = state.map?.id ?? null;
    if (this.frame) this.frame.titleBar.querySelector("span")!.textContent = id ? t.title(id.bank, id.map) : t.titleNone;
    const project = session?.project;
    let note = t.noMap;
    this.pointers = [];
    if (project && id) {
      const banks = project.base.bankTable;
      this.pointers = project.inBase(id) ? listMapPointers(project.rom, banks, id) : [];
      note = !project.inBase(id) ? t.notInRom : project.hasJson(id) ? t.jsonNote : t.romNote;
    }
    if (this.note) this.note.textContent = note;
    this.renderTable();
    this.followEvent();
  }

  /** 行を選ぶ（イベントの行ならイベントタブでも選ぶ）。 */
  selectRow(i: number, fromEvent = false): void {
    this.rows.forEach((r, j) => r.classList.toggle("selected", j === i));
    this.rows[i]?.scrollIntoView({ block: "nearest" });
    const ev = this.pointers[i] ? eventOf(this.pointers[i]) : null;
    if (ev && !fromEvent) this.host.selectEvent(ev.kind, ev.index);
  }

  /**
   * 参照元を探す。`address` は ROM の上の位置かポインタの値。`romPath` が null なら開いているベース ROM。
   * 見つけた場所と名前を返す（結果は窓にも出す）。
   */
  async search(address: number, romPath: string | null = null): Promise<PointerSearchResult> {
    const session = this.host.state.session;
    if (!session) throw new Error(t.noMap);
    const token = ++this.searching;
    const bytes = romPath ? await readFile(romPath) : session.project.rom.bytes;
    const value = toPointerValue(address, bytes.length);
    if (value === null) throw new Error(t.badAddress);
    if (this.addressInput) this.addressInput.value = hex(value, 8);
    const t0 = performance.now();
    let chunks = 0;
    const offsets = await findPointerRefsChunked(bytes, value, {
      chunk: SEARCH_CHUNK,
      pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
      progress: (done, total) => {
        chunks++;
        if (this.status && token === this.searching) this.status.textContent = t.searching(Math.round((done * 100) / total));
      },
      cancelled: () => token !== this.searching,
    });
    const ms = performance.now() - t0;
    // 名前は、探した ROM のマップの表で付ける（ほかの ROM なら、その ROM のバンク表を読む）
    const ranges = romPath ? otherRanges(bytes, session.project.game.offsets.mapBankTablePointer) : this.baseRanges(session.project.rom);
    const hits = offsets.map((offset) => ({ offset, place: placeName(ranges, offset) }));
    const result: PointerSearchResult = { value, rom: romPath ?? session.romPath, hits, ms, chunks };
    if (token === this.searching) {
      this.last = result;
      this.renderResult(result);
    }
    return result;
  }

  private baseRanges(rom: Rom): KnownRange[] {
    if (this.ranges?.rom !== rom) {
      const session = this.host.state.session!;
      this.ranges = { rom, ranges: knownMapRanges(rom, session.project.base.bankTable) };
    }
    return this.ranges.ranges;
  }

  private build(): void {
    const frame = createDialog({ title: t.titleNone, modal: false, className: "pointer-dialog", onClose: () => this.close() });
    frame.box.dataset["autoId"] = "pointers";
    frame.box.style.left = "260px";
    frame.box.style.top = "80px";
    const note = document.createElement("p");
    note.className = "pointer-note";
    const table = document.createElement("div");
    table.className = "pointer-table";
    table.dataset["autoId"] = "pointers.list";
    // 参照元の検索
    const search = document.createElement("fieldset");
    search.className = "pointer-search";
    const legend = document.createElement("legend");
    legend.textContent = t.searchTitle;
    const row = document.createElement("div");
    row.className = "pointer-search-row";
    const label = document.createElement("label");
    label.textContent = t.address;
    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.title = t.addressHint;
    input.placeholder = "08000000";
    input.dataset["autoId"] = "pointers.address";
    const select = document.createElement("select");
    select.dataset["autoId"] = "pointers.rom";
    select.append(new Option(t.romBase, "base"), new Option(t.romOther, "other"));
    select.addEventListener("change", () => void this.pickOther());
    const go = dialogButton(t.search, () => void this.searchFromInput());
    go.dataset["autoId"] = "pointers.search";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.searchFromInput();
    });
    row.append(label, input, select, go);
    const status = document.createElement("div");
    status.className = "pointer-status";
    status.dataset["autoId"] = "pointers.status";
    const results = document.createElement("div");
    results.className = "pointer-table pointer-results";
    results.dataset["autoId"] = "pointers.results";
    search.append(legend, row, status, results);
    const bar = document.createElement("div");
    bar.className = "help-buttons";
    const close = dialogButton(t.close, () => this.close());
    close.dataset["autoId"] = "pointers.close";
    bar.append(close);
    frame.body.append(note, table, search, bar);
    handleDialogKeys(frame, () => this.close());
    frame.register({ title: t.titleNone, text: "", buttons: [t.close], press: () => this.close() });
    this.frame = frame;
    this.note = note;
    this.table = table;
    this.status = status;
    this.resultBox = results;
    this.addressInput = input;
    this.romSelect = select;
    const state = this.host.state;
    this.unsubscribe.push(state.on("map", () => this.refresh()));
    this.unsubscribe.push(state.on("session", () => this.refresh()));
  }

  private async pickOther(): Promise<void> {
    const select = this.romSelect!;
    if (select.value !== "other") {
      this.otherRom = null;
      return;
    }
    const path = await this.host.files.openFile({ title: t.romOtherPick, filters: [{ name: "GBA ROM", extensions: ["gba"] }] });
    if (!path) {
      select.value = this.otherRom ? "other" : "base";
      return;
    }
    this.otherRom = path;
    select.options[1]!.text = `${t.romOther.replace("…", "")}: ${path.split(/[\\/]/).pop()}`;
  }

  private async searchFromInput(): Promise<void> {
    const text = (this.addressInput?.value ?? "").trim().replace(/^0x/i, "");
    const value = /^[0-9a-f]{1,8}$/i.test(text) ? parseInt(text, 16) : NaN;
    try {
      if (!Number.isFinite(value)) throw new Error(t.badAddress);
      await this.search(value, this.romSelect?.value === "other" ? this.otherRom : null);
    } catch (e) {
      if (this.status) this.status.textContent = e instanceof Error ? e.message : String(e);
    }
  }

  private renderTable(): void {
    const table = this.table;
    if (!table) return;
    const head = headRow([t.columns.name, t.columns.location, t.columns.value, t.columns.bytes]);
    this.rows = this.pointers.map((p, i) => {
      const r = dataRow([nameOf(p), hex(p.location, 6), p.value === 0 ? t.none : hex(p.value, 8), p.bytes.map((b) => hex(b, 2)).join(" ")]);
      r.dataset["autoId"] = `pointers.row.${i}`;
      r.addEventListener("click", () => this.selectRow(i));
      r.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.selectRow(i);
        showContextMenu(e.clientX, e.clientY, [
          { id: "copyValue", label: t.copyValue, run: () => this.copy(hex(p.value, 8)) },
          { id: "copyBytes", label: t.copyBytes, run: () => this.copy(p.bytes.map((b) => hex(b, 2)).join(" ")) },
          { id: "copyLocation", label: t.copyLocation, run: () => this.copy(hex(p.location, 6)) },
        ]);
      });
      return r;
    });
    table.replaceChildren(head, ...this.rows);
  }

  private renderResult(result: PointerSearchResult): void {
    if (this.status) this.status.textContent = t.found(result.hits.length, result.ms, result.rom.split(/[\\/]/).pop() ?? result.rom);
    const box = this.resultBox;
    if (!box) return;
    const rows = result.hits.map((h, i) => {
      const r = dataRow([hex(h.offset, 6), h.place]);
      r.dataset["autoId"] = `pointers.result.${i}`;
      r.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { id: "copyLocation", label: t.copyLocation, run: () => this.copy(hex(h.offset, 6)) },
          { id: "copyValue", label: t.copyValue, run: () => this.copy(hex(h.offset + 0x08000000, 8)) },
        ]);
      });
      return r;
    });
    box.replaceChildren(headRow([t.resultColumns.location, t.resultColumns.where]), ...rows);
  }

  private copy(text: string): void {
    this.host.copyText(text);
    this.host.state.setStatus(t.copied(text));
  }

  /** イベントタブで選んでいるイベントの行を選ぶ（逆向きの連動）。 */
  followEvent(): void {
    const sel = this.host.eventSelection();
    if (!sel || !this.frame) return;
    const i = this.pointers.findIndex((p) => {
      const ev = eventOf(p);
      return ev !== null && ev.kind === sel.kind && ev.index === sel.index;
    });
    if (i >= 0) this.selectRow(i, true);
  }
}

/** 行のイベント（人・看板・スクリプトタイルのスクリプト。無ければ null）。 */
function eventOf(p: MapPointer): EventRef | null {
  if (p.index === null) return null;
  if (p.kind === "personScript") return { kind: "person", index: p.index };
  if (p.kind === "signScript") return { kind: "sign", index: p.index };
  if (p.kind === "trapScript") return { kind: "trap", index: p.index };
  return null;
}

function nameOf(p: MapPointer): string {
  const base = t.kinds[p.kind] ?? p.kind;
  if (p.kind === "mapScript") return t.mapScript(p.index ?? 0);
  return p.index !== null ? t.indexed(base, p.index) : base;
}

/** 見つかった場所の名前。 */
function placeName(ranges: readonly KnownRange[], offset: number): string {
  const hit = rangeAt(ranges, offset);
  if (!hit) return t.unknownPlace;
  const r = hit.range;
  const id = r.map;
  switch (r.kind) {
    case "bankTable":
      return t.place.bankTable(hit.element ?? 0);
    case "bankList":
      return t.place.bankList(r.index ?? 0, hit.element ?? 0);
    case "header":
      return t.place.header(id!.bank, id!.map, t.headerFields[hit.at] ?? `+${hex(hit.at, 2)}`);
    case "layout":
      return t.place.layout(id!.bank, id!.map, hit.at);
    case "events":
      return t.place.events(id!.bank, id!.map, hit.at);
    default:
      return t.place.list(id!.bank, id!.map, t.listNames[r.kind] ?? r.kind, hit.element ?? 0, hit.at);
  }
}

/** ほかの ROM のマップの表（読めなければ空。名前を付けないだけで、検索の結果は出す）。 */
function otherRanges(bytes: Uint8Array, tablePointer: number): KnownRange[] {
  try {
    const rom = new Rom(bytes);
    return knownMapRanges(rom, MapBankTable.read(rom, tablePointer));
  } catch {
    return [];
  }
}

function headRow(cells: readonly string[]): HTMLElement {
  const r = dataRow(cells);
  r.classList.add("head");
  return r;
}

function dataRow(cells: readonly string[]): HTMLElement {
  const r = document.createElement("div");
  r.className = `pointer-row cols-${cells.length}`;
  for (const c of cells) {
    const span = document.createElement("span");
    span.textContent = c;
    r.append(span);
  }
  return r;
}
