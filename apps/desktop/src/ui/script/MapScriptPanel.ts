import {
  MAP_SCRIPT_TYPE_NAMES,
  SetMapScriptTableCommand,
  asmBlockText,
  emptyScriptTemplate,
  isMapScriptTableType,
  isTableType,
  mapScriptAddress,
  mapScriptTableFromEntries,
  mapScriptTargetLabel,
  newScriptLabel,
  scriptLabelMapName,
  tableArgs,
  type MapScriptCondition,
  type MapScriptItem,
  type MapScriptTableModel,
  NEW_SCRIPT_FILE_TEXT,
} from "@zigzagumap/core";
import { hex, ja } from "../../i18n/ja";
import { jaMapScriptPanel as t } from "../../i18n/ja.mapScriptPanel";
import "../../styles/mapScriptPanel.css";
import type { HeaderContext } from "../header/HeaderContext";
import { scriptEntry } from "./ScriptEntry";
import { ScriptLabelField } from "./ScriptLabelField";
import type { ScriptLink } from "./ScriptLink";

/**
 * 場所の設定タブ「かんたん（CFRU）」のマップスクリプトの専用パネル（#208）。
 * 表は `.s` に書き（ZigzaguMap の印の行の間。出力のときに書き直す）、eventscripts の `map` の行で指す。
 * 種類ごとの一覧、条件表（変数・値・行き先）、行き先のラベルの選択と補完（イベントタブと同じ欄）、ひな形を作るボタン。
 * ROM のポインタ（オフセット）の欄は出さない。表の編集はどれも 1 回の操作として元に戻せる（SetMapScriptTableCommand）。
 * プロジェクトフォルダが無いときは、ROM のマップスクリプトを読むだけの一覧にする。
 */
export class MapScriptPanel {
  /** 作ったパネル（自動操作の `script.mapScripts` が使う。かんたん表示に 1 つだけ）。 */
  static current: MapScriptPanel | null = null;
  readonly element: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private readonly foot: HTMLElement;
  private ctx: HeaderContext | null = null;
  /** 欄を作り直さずに済むよう、同じ表なら描き直さない。 */
  private shown = "";

  constructor(private readonly link: ScriptLink) {
    MapScriptPanel.current = this;
    this.element = document.createElement("div");
    this.element.className = "map-script-panel";
    this.element.dataset["autoId"] = "easy.ms";
    this.head = document.createElement("div");
    this.head.className = "msp-head";
    this.list = document.createElement("div");
    this.list.className = "msp-list";
    this.foot = document.createElement("div");
    this.foot.className = "msp-foot";
    this.element.append(this.head, this.list, this.foot);
    link.files.onChange(() => {
      this.shown = "";
      if (this.ctx) this.render(this.ctx);
    });
  }

  /** 表示中のマップの表。 */
  get table(): MapScriptTableModel | null {
    const c = this.ctx;
    return c ? (c.session.labels.store.get(c.map.id.bank, c.map.id.map).table ?? null) : null;
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const project = !!ctx.session.projectDir;
    const { bank, map } = ctx.map.id;
    const labels = project ? ctx.session.labels.store.get(bank, map) : null;
    const key = JSON.stringify([bank, map, project, labels?.table ?? null, labels?.mapScripts ?? null, project ? null : ctx.doc.mapScripts]);
    if (key === this.shown) return;
    this.shown = key;
    if (!project) return this.renderRomOnly(ctx);
    const table = labels!.table;
    if (!table) return this.renderNoTable(ctx, labels!.mapScripts);
    this.renderTable(ctx, table);
  }

  // ---- プロジェクトが無いとき・表が無いとき ----

  private renderRomOnly(ctx: HeaderContext): void {
    this.head.replaceChildren(note(t.romOnly));
    this.list.replaceChildren(...this.romItems(ctx));
    this.foot.replaceChildren();
  }

  private renderNoTable(ctx: HeaderContext, external: string | null): void {
    this.head.replaceChildren(note(external ? t.externalTable(external) : t.noTable));
    this.list.replaceChildren(...this.romItems(ctx));
    const create = button("easy.ms.create", t.create, () => this.create());
    this.foot.replaceChildren(create);
  }

  /** ROM（か maps\ の JSON）のマップスクリプトを、読むだけの行にする。 */
  private romItems(ctx: HeaderContext): HTMLElement[] {
    const entries = ctx.doc.mapScripts ?? [];
    if (entries.length === 0) return [note(t.romEmpty)];
    return entries.map((e, i) => {
      const row = document.createElement("div");
      row.className = "msp-rom-row";
      row.dataset["autoId"] = `easy.ms.rom:${i}`;
      const name = `${hex(e.type, 2)} ${ja.mapScriptTypes[e.type] ?? "???"}`;
      const where = isTableType(e.type) && e.table ? t.romTable(e.table.entries.length) : mapScriptAddress(e.pointer);
      row.textContent = `${name}　${where}`;
      const open = button(`easy.ms.romOpen:${i}`, t.view, () => {
        const pointer = isTableType(e.type) ? e.table?.entries[0]?.script : e.pointer;
        if (pointer) scriptEntry.openPointer(pointer, { map: ctx.map.id, kind: "map", index: i });
      });
      open.disabled = isTableType(e.type) && !e.table?.entries.length;
      row.append(open);
      return row;
    });
  }

  // ---- 表 ----

  private renderTable(_ctx: HeaderContext, table: MapScriptTableModel): void {
    this.head.replaceChildren(note(t.tableLabel(table.label)));
    const rows: HTMLElement[] = [];
    table.items.forEach((item, i) => rows.push(this.itemRow(table, item, i)));
    if (table.items.length === 0) rows.push(note(t.empty));
    this.list.replaceChildren(...rows);
    const add = document.createElement("select");
    add.dataset["autoId"] = "easy.ms.addType";
    const used = new Set(table.items.map((x) => x.type));
    add.append(new Option(t.addPrompt, ""));
    for (let type = 1; type <= 7; type++) if (!used.has(type)) add.append(new Option(typeName(type), String(type)));
    add.addEventListener("change", () => {
      const type = Number(add.value);
      if (type >= 1) void this.addItem(type);
    });
    const remove = button("easy.ms.removeTable", t.removeTable, () => this.commit(null));
    this.foot.replaceChildren(add, remove);
  }

  private itemRow(table: MapScriptTableModel, item: MapScriptItem, i: number): HTMLElement {
    const box = document.createElement("div");
    box.className = "msp-item";
    box.dataset["autoId"] = `easy.ms.item:${i}`;
    const head = document.createElement("div");
    head.className = "msp-item-head";
    const name = document.createElement("span");
    name.className = "msp-type";
    name.textContent = typeName(item.type);
    head.append(name);
    if (!isMapScriptTableType(item.type)) {
      const field = this.labelField(`easy.ms.item:${i}.script`, item.script, (label) => this.setItem(i, { ...item, script: label }));
      head.append(field.element, button(`easy.ms.item:${i}.open`, t.open, () => this.openTarget(item.script)));
    }
    head.append(button(`easy.ms.item:${i}.remove`, t.remove, () => this.commit({ ...table, items: table.items.filter((_, j) => j !== i) })));
    box.append(head);
    if (isMapScriptTableType(item.type)) {
      item.conditions.forEach((c, j) => box.append(this.conditionRow(item, i, c, j)));
      const add = button(`easy.ms.item:${i}.addCondition`, t.addCondition, () => void this.addCondition(i));
      box.append(add);
    }
    return box;
  }

  private conditionRow(item: MapScriptItem, i: number, c: MapScriptCondition, j: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "msp-condition";
    const id = `easy.ms.item:${i}.condition:${j}`;
    const set = (patch: Partial<MapScriptCondition>): void =>
      this.setItem(i, { ...item, conditions: item.conditions.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
    const variable = hexInput(`${id}.variable`, c.variable, (v) => set({ variable: v }));
    const value = hexInput(`${id}.value`, c.value, (v) => set({ value: v }));
    const field = this.labelField(`${id}.script`, c.script, (label) => set({ script: label }));
    row.append(
      text(t.variable),
      variable,
      text(t.value),
      value,
      field.element,
      button(`${id}.open`, t.open, () => this.openTarget(c.script)),
      button(`${id}.remove`, t.remove, () => this.setItem(i, { ...item, conditions: item.conditions.filter((_, k) => k !== j) })),
    );
    return row;
  }

  /** 行き先のラベルの欄（マップの .s のラベルから選ぶ。アドレス `0x...` も書ける）。 */
  private labelField(id: string, value: string, commit: (label: string) => void): ScriptLabelField {
    const ctx = this.ctx!;
    let current = value === "" ? null : value;
    const field = new ScriptLabelField(
      {
        available: () => true,
        current: () => current,
        candidates: async () => {
          const r = ctx.session.scriptsTable.document.resolve(ctx.map.id.bank, ctx.map.id.map);
          return r ? this.link.files.labelsOf(r.script) : [];
        },
        commit: (label) => {
          // 行き先は空にできない（空にしたら元に戻す）
          if (label === null) return field.show();
          current = label;
          commit(label);
        },
        onCandidatesChanged: () => () => undefined,
      },
      id,
      180,
      true,
    );
    field.show();
    return field;
  }

  /** 行き先のスクリプトをエディタで開く（ラベルならその行、アドレスなら ROM のスクリプト）。 */
  private openTarget(script: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (/^0x/i.test(script)) scriptEntry.openPointer(parseInt(script, 16), { map: ctx.map.id, kind: "map" });
    else void this.link.openLabel(script);
  }

  /**
   * 何もしないスクリプトのひな形（条件表なら、変数を次の値にして繰り返しを止める）を `.s` に書き、`next(ラベル)` の表にする。
   * 書き足しは表を変えるコマンドに結び付ける（元に戻すと、手を入れていなければ消える）。
   */
  private async withTemplate(type: number, condition: { variable: number; value: number } | null, next: (label: string) => MapScriptTableModel): Promise<boolean> {
    const ctx = this.ctx;
    const table = this.table;
    if (!ctx || !table) return false;
    const { bank, map } = ctx.map.id;
    const resolved = ctx.session.scriptsTable.document.resolve(bank, map);
    const config = (await this.link.scriptConfig())?.config;
    if (!resolved || !config) {
      ctx.state.setStatus(t.noScriptFile(bank, map), undefined, true);
      return false;
    }
    const known = new Set([...(await this.link.files.labelsOf(resolved.script)), ...ctx.session.labels.store.usedLabels()]);
    const label = mapScriptTargetLabel(table.label, type, (n) => known.has(n));
    const setvar = condition ? { variable: condition.variable, value: (condition.value + 1) & 0xffff } : undefined;
    const tp = emptyScriptTemplate(label, { dialect: config.dialect, useGlobal: config.useGlobal }, setvar);
    const loaded = await this.link.files.read(resolved.script);
    const block = asmBlockText(tp.asm, loaded?.text.includes("\r\n") ? "\r\n" : "\n");
    const added = await this.link.files.append(resolved.script, block, NEW_SCRIPT_FILE_TEXT);
    const command = new SetMapScriptTableCommand({ bank, map, table: tableArgs(next(label)) });
    if (!this.link.execute(command)) {
      await this.link.files.remove(resolved.script, added);
      return false;
    }
    this.link.attachEdits(command, [{ path: resolved.script, block, create: NEW_SCRIPT_FILE_TEXT, added }]);
    ctx.state.setStatus(t.templateWritten(label, resolved.script));
    return true;
  }

  /** 条件表に行を足す（変数 0x4000・値 0。行き先はひな形を書いて付ける）。 */
  async addCondition(i: number): Promise<boolean> {
    const table = this.table;
    const item = table?.items[i];
    if (!table || !item) return false;
    const c = { variable: 0x4000, value: 0 };
    return this.withTemplate(item.type, c, (label) => ({
      ...table,
      items: table.items.map((x, j) => (j === i ? { ...x, conditions: [...x.conditions, { ...c, script: label }] } : x)),
    }));
  }

  // ---- 変える ----

  /** 「表を作る」: 今の ROM（か JSON）のマップスクリプトを、アドレスのまま表にする（ビルドしても動きは変わらない）。 */
  create(): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const { bank, map } = ctx.map.id;
    const resolved = ctx.session.scriptsTable.document.resolve(bank, map);
    if (!resolved) {
      ctx.state.setStatus(t.noScriptFile(bank, map), undefined, true);
      void import("./ScriptsTableDialog").then(({ ensureScriptFile }) => ensureScriptFile(ctx.state, bank, map));
      return false;
    }
    const config = this.link.configNow();
    const known = new Set([...(this.link.files.cachedLabels(resolved.script) ?? []), ...ctx.session.labels.store.usedLabels()]);
    const label = newScriptLabel(config?.labelTemplate ?? "{map}_{kind}{index}", { map: scriptLabelMapName(resolved.script, bank, map), kind: "map", index: 0 }, (n) => known.has(n));
    return this.commit(mapScriptTableFromEntries(label, ctx.doc.mapScripts ?? []));
  }

  /** 種類を足す（同じ種類は 1 つだけ）。行き先はひな形を書いて付ける。条件表の種類は、条件の行を 1 つ付けて足す。 */
  async addItem(type: number): Promise<boolean> {
    const table = this.table;
    if (!table || table.items.some((x) => x.type === type) || type < 1 || type > 7) return false;
    const sorted = (items: MapScriptItem[]): MapScriptItem[] => items.sort((a, b) => a.type - b.type);
    if (isMapScriptTableType(type)) {
      const c = { variable: 0x4000, value: 0 };
      return this.withTemplate(type, c, (label) => ({ ...table, items: sorted([...table.items, { type, script: "", conditions: [{ ...c, script: label }] }]) }));
    }
    return this.withTemplate(type, null, (label) => ({ ...table, items: sorted([...table.items, { type, script: label, conditions: [] }]) }));
  }

  private setItem(i: number, item: MapScriptItem): void {
    const table = this.table;
    if (table) this.commit({ ...table, items: table.items.map((x, j) => (j === i ? item : x)) });
  }

  /** 表を変える（1 回の操作）。 */
  commit(table: MapScriptTableModel | null): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const { bank, map } = ctx.map.id;
    return this.link.execute(new SetMapScriptTableCommand({ bank, map, table: tableArgs(table) }));
  }
}

function typeName(type: number): string {
  return `${hex(type, 2)} ${ja.mapScriptTypes[type] ?? MAP_SCRIPT_TYPE_NAMES[type] ?? "???"}`;
}

function note(s: string): HTMLElement {
  const p = document.createElement("div");
  p.className = "msp-note";
  p.textContent = s;
  return p;
}

function text(s: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = s;
  return span;
}

function button(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.dataset["autoId"] = id;
  b.addEventListener("click", onClick);
  return b;
}

function hexInput(id: string, value: number, commit: (v: number) => void): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.className = "msp-hex";
  el.value = value.toString(16).toUpperCase().padStart(4, "0");
  el.dataset["autoId"] = id;
  el.addEventListener("change", () => {
    const v = parseInt(el.value.replace(/^(0x|\$)/i, ""), 16);
    if (Number.isInteger(v) && v >= 0 && v <= 0xffff) commit(v);
    else el.classList.add("invalid");
  });
  return el;
}
