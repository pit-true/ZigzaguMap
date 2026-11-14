import {
  AddScriptsTableEntryCommand,
  MoveScriptsTableEntryCommand,
  RemoveScriptsTableEntryCommand,
  SetScriptsTableEntryCommand,
  defaultScriptsJsonStringsPath,
  normalizeScriptPath,
  type ScriptsJsonEntry,
  type ScriptsTableEntryArgs,
  type ScriptsTableProject,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaScriptsTable as t } from "../../i18n/ja.scriptsTable";
import { createDialog, dialogButton, handleDialogKeys, pressable, type DialogFrame } from "../Dialog";
import { askYesNo, showError } from "../MessageBox";
import { autoId } from "../form/controls";
import { openNewScriptDialog } from "./NewScriptDialog";
import { StringsField, currentMap, field, parseBank, parseMap, runScriptsCommand, showScriptsError } from "./scriptsTableForm";

/** ダイアログが使う App の操作。 */
export interface ScriptsTableHost {
  readonly state: EditorState;
  exportMaps(chooseFolder: boolean): Promise<unknown>;
  undo(): void;
  redo(): void;
}

/** 対応表の 1 行を画面に出す形（自動操作の `scripts.table` の返事にも使う）。 */
export interface ScriptsTableRowView {
  readonly bank: number;
  readonly map: number | null;
  readonly name: string;
  readonly script: string;
  /** scripts.json の `Strings`（省いていれば null）。 */
  readonly strings: string | null;
  /** 実際に使う `.string`（省いていれば既定の名前）。 */
  readonly resolvedStrings: string;
  /** 出力のときに `.s` と `.string` を作る行。 */
  readonly create: boolean;
  /** 前の行と同じバンク・マップを指していて使われない行。 */
  readonly unused: boolean;
}

/** 対応表の今の状態（自動操作の `scripts.table`）。 */
export function scriptsTableView(table: ScriptsTableProject): {
  loadError: string | null;
  modified: boolean;
  rows: ScriptsTableRowView[];
  pendingFiles: { script: string; strings: string }[];
  duplicates: { first: number; duplicate: number }[];
} {
  const doc = table.document;
  const duplicates = doc.duplicates();
  const unused = new Set(duplicates.map((d) => d.duplicate));
  return {
    loadError: table.loadError,
    modified: table.isModified(),
    rows: doc.rows.map((r, i) => ({
      ...entryArgsOf(r.entry),
      resolvedStrings: r.entry.strings ?? defaultScriptsJsonStringsPath(r.entry.script),
      create: r.create,
      unused: unused.has(i),
    })),
    pendingFiles: table.pendingFiles().map((f) => ({ ...f })),
    duplicates,
  };
}

function entryArgsOf(e: ScriptsJsonEntry): ScriptsTableEntryArgs {
  return { bank: e.bank, map: e.map, name: e.name, script: e.script, strings: e.strings };
}

/**
 * ツール > スクリプトファイルの対応表。maps\scripts.json の行（バンク・マップ・マップ名・.s・.string）を編集する。
 * 編集はどれもコマンド（アンドゥできる）で、ファイルに書くのは出力（Ctrl+S）のとき。モードレスで、開いたままマップを切り替えられる。
 * 初めて開くときに読み込む（App から動的に読み込む）。
 */
export class ScriptsTableDialog {
  private static instance: ScriptsTableDialog | null = null;
  private frame: DialogFrame | null = null;
  private selected = -1;
  private readonly list: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly bank: HTMLInputElement;
  private readonly map: HTMLInputElement;
  private readonly name: HTMLInputElement;
  private readonly script: HTMLInputElement;
  private readonly strings: StringsField;
  private readonly buttons: Record<"add" | "save" | "remove" | "up" | "down" | "newScript" | "close", HTMLButtonElement>;
  private readonly content: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  /** 1 つだけ作る。 */
  static get(host: ScriptsTableHost): ScriptsTableDialog {
    ScriptsTableDialog.instance ??= new ScriptsTableDialog(host);
    return ScriptsTableDialog.instance;
  }

  /** 開いていれば今のもの（自動操作用）。 */
  static current(): ScriptsTableDialog | null {
    return ScriptsTableDialog.instance?.frame ? ScriptsTableDialog.instance : null;
  }

  private constructor(private readonly host: ScriptsTableHost) {
    this.content = document.createElement("div");
    const intro = document.createElement("p");
    intro.textContent = t.intro;
    this.list = autoId(document.createElement("div"), "scriptsTable.list");
    this.list.className = "st-list";
    const form = document.createElement("div");
    form.className = "st-form";
    this.bank = field(form, "scriptsTable.bank", t.bank);
    this.map = field(form, "scriptsTable.map", t.map, false, t.mapHint);
    this.name = field(form, "scriptsTable.name", t.name, true);
    this.script = field(form, "scriptsTable.script", t.script, true);
    this.strings = new StringsField(field(form, "scriptsTable.strings", t.strings, true, t.stringsHint), () => this.script.value);
    this.script.addEventListener("input", () => this.strings.follow());
    const button = (key: keyof ScriptsTableDialog["buttons"], text: string, onClick: () => void): HTMLButtonElement =>
      autoId(dialogButton(text, onClick), `scriptsTable.${key}`);
    this.buttons = {
      add: button("add", t.add, () => this.add()),
      save: button("save", t.save, () => this.save()),
      remove: button("remove", t.remove, () => void this.remove()),
      up: button("up", t.up, () => this.move(-1)),
      down: button("down", t.down, () => this.move(1)),
      newScript: button("newScript", t.newScript, () => void this.newScript()),
      close: button("close", t.close, () => this.close()),
    };
    const bar = document.createElement("div");
    bar.className = "st-buttons";
    const spacer = document.createElement("span");
    spacer.className = "st-spacer";
    const b = this.buttons;
    bar.append(b.newScript, b.add, b.save, b.remove, b.up, b.down, spacer, b.close);
    this.warning = autoId(document.createElement("div"), "scriptsTable.warning");
    this.warning.className = "st-warning";
    const note = autoId(document.createElement("div"), "scriptsTable.note");
    note.className = "st-note";
    note.textContent = t.note;
    this.content.append(intro, this.list, form, bar, this.warning, note);
    host.state.on("session", () => this.close());
  }

  /** 開いているか。 */
  get isOpen(): boolean {
    return this.frame !== null;
  }

  /** 選んでいる行（無ければ -1）。 */
  get selectedIndex(): number {
    return this.selected;
  }

  /** 開く（開いていれば手前の状態のまま）。プロジェクトフォルダが無ければ案内だけ出す。 */
  async open(): Promise<void> {
    const session = this.host.state.session;
    if (!session) return;
    if (!session.projectDir) {
      await showError(t.noProject);
      return;
    }
    if (this.frame) return;
    const frame = createDialog({ title: t.title, className: "scripts-table-dialog", modal: false, onClose: () => this.close() });
    frame.box.style.left = "80px";
    frame.box.style.top = "80px";
    frame.body.append(this.content);
    handleDialogKeys(frame, () => this.close(), (e) => this.keys(e));
    frame.register({
      title: t.title,
      text: t.intro,
      ...pressable([
        { label: t.add, run: () => this.add() },
        { label: t.save, run: () => this.save() },
        { label: t.remove, run: () => void this.remove() },
        { label: t.newScript, run: () => void this.newScript() },
        { label: t.close, aliases: ["ok", "cancel"], run: () => this.close() },
      ]),
    });
    this.frame = frame;
    this.unsubscribe = session.bus.subscribe(() => this.render());
    this.selected = session.scriptsTable.document.count > 0 ? 0 : -1;
    this.render();
    this.loadForm();
  }

  /** 閉じる。 */
  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.frame?.remove();
    this.frame = null;
  }

  /** 行を選んで、下の欄に入れる。 */
  select(index: number): void {
    this.selected = index;
    this.render();
    this.loadForm();
  }

  private table(): ScriptsTableProject | null {
    return this.host.state.session?.scriptsTable ?? null;
  }

  /** Ctrl+Z / Ctrl+Y / Ctrl+S（入力欄の中ではブラウザの動きに任せる。Ctrl+S だけはどこでも出力）。 */
  private keys(e: KeyboardEvent): void {
    if (!e.ctrlKey || e.altKey) return;
    const key = e.key.toUpperCase();
    const typing = e.target instanceof HTMLInputElement;
    if (key === "S") {
      e.preventDefault();
      void this.host.exportMaps(false);
    } else if (!typing && (key === "Z" || key === "Y")) {
      e.preventDefault();
      if (key === "Z" && !e.shiftKey) this.host.undo();
      else this.host.redo();
    }
  }

  /** 表と警告を描き直す（コマンドの実行・取り消しのたびに呼ばれる）。 */
  private render(): void {
    const table = this.table();
    if (!this.frame || !table) return;
    const view = scriptsTableView(table);
    if (this.selected >= view.rows.length) this.selected = view.rows.length - 1;
    const editable = table.loadError === null;
    const head = document.createElement("tr");
    for (const [text, width] of [
      ["#", 28],
      [t.colBank, 48],
      [t.colMap, 56],
      [t.colName, 130],
      [t.colScript, 0],
      [t.colStrings, 0],
    ] as const) {
      const th = document.createElement("th");
      th.textContent = text;
      if (width) th.style.width = `${width}px`;
      head.append(th);
    }
    const tableEl = document.createElement("table");
    const thead = document.createElement("thead");
    thead.append(head);
    const tbody = document.createElement("tbody");
    view.rows.forEach((r, i) => {
      const tr = autoId(document.createElement("tr"), `scriptsTable.row.${i}`);
      tr.className = "st-row";
      tr.classList.toggle("selected", i === this.selected);
      tr.classList.toggle("unused", r.unused);
      const cells = [
        String(i + 1),
        String(r.bank),
        r.map === null ? t.wholeBank : String(r.map),
        r.name,
        r.script,
        r.strings === null ? t.defaultStrings(r.resolvedStrings) : r.strings,
      ];
      for (const text of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        td.title = text;
        tr.append(td);
      }
      if (r.create) {
        // 長いパスで切れないよう、.s の欄の頭に付ける
        const mark = document.createElement("span");
        mark.className = "st-new";
        mark.textContent = `[${t.newMark}] `;
        tr.children[4]!.prepend(mark);
      }
      tr.addEventListener("click", () => this.select(i));
      tbody.append(tr);
    });
    tableEl.append(thead, tbody);
    this.list.replaceChildren(tableEl);
    if (view.rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "st-empty";
      empty.textContent = editable ? t.empty : "";
      this.list.append(empty);
    }
    const warnings = table.loadError !== null ? [t.loadError(table.loadError)] : view.duplicates.map((d) => t.duplicate(d.first, d.duplicate));
    this.warning.textContent = warnings.join("\n");
    const has = this.selected >= 0;
    for (const el of [this.bank, this.map, this.name, this.script, this.strings.input]) el.disabled = !editable;
    this.buttons.add.disabled = !editable;
    this.buttons.newScript.disabled = !editable;
    this.buttons.save.disabled = !editable || !has;
    this.buttons.remove.disabled = !editable || !has;
    this.buttons.up.disabled = !editable || this.selected <= 0;
    this.buttons.down.disabled = !editable || !has || this.selected >= view.rows.length - 1;
  }

  /** 選んでいる行を下の欄に入れる（無ければ今のマップで空の行）。 */
  private loadForm(): void {
    const row = this.table()?.document.rows[this.selected]?.entry;
    if (row) {
      this.bank.value = String(row.bank);
      this.map.value = row.map === null ? "" : String(row.map);
      this.name.value = row.name;
      this.script.value = row.script;
      this.strings.load(row.strings);
    } else {
      const current = currentMap(this.host.state);
      this.bank.value = current ? String(current.bank) : "";
      this.map.value = current ? String(current.map) : "";
      this.name.value = current?.name ?? "";
      this.script.value = "";
      this.strings.load(null);
    }
  }

  /** 下の欄の値（入力エラーなら InputError）。 */
  private formEntry(original: ScriptsJsonEntry | undefined): ScriptsTableEntryArgs {
    return {
      bank: parseBank(this.bank.value),
      map: parseMap(this.map.value),
      name: this.name.value,
      script: normalizeScriptPath(this.script.value),
      strings: this.strings.value(original === undefined ? undefined : original.strings),
    };
  }

  private add(): void {
    const table = this.table();
    if (!table) return;
    let entry: ScriptsTableEntryArgs;
    try {
      entry = this.formEntry(undefined);
    } catch (e) {
      void showScriptsError(e);
      return;
    }
    const index = table.document.count;
    if (runScriptsCommand(this.host.state, new AddScriptsTableEntryCommand({ entry }))) this.select(index);
  }

  private save(): void {
    const table = this.table();
    const original = table?.document.rows[this.selected]?.entry;
    if (!table || !original) return void showError(t.notSelected);
    let entry: ScriptsTableEntryArgs;
    try {
      entry = this.formEntry(original);
    } catch (e) {
      void showScriptsError(e);
      return;
    }
    if (JSON.stringify(entry) === JSON.stringify(entryArgsOf(original))) return;
    if (runScriptsCommand(this.host.state, new SetScriptsTableEntryCommand({ index: this.selected, entry }))) this.select(this.selected);
  }

  private async remove(): Promise<void> {
    const index = this.selected;
    if (index < 0) return;
    if (!(await askYesNo(t.confirmRemove(index + 1)))) return;
    if (runScriptsCommand(this.host.state, new RemoveScriptsTableEntryCommand({ index }))) this.select(Math.min(index, (this.table()?.document.count ?? 0) - 1));
  }

  private move(delta: number): void {
    const index = this.selected;
    const to = index + delta;
    if (index < 0 || to < 0 || to >= (this.table()?.document.count ?? 0)) return;
    if (runScriptsCommand(this.host.state, new MoveScriptsTableEntryCommand({ index, to }))) this.select(to);
  }

  /** 「新しい .s を作る」。今の欄のバンク・マップ（読めなければ表示中のマップ）を初めの値にする。 */
  private async newScript(): Promise<void> {
    let bank: number | null = null;
    let map: number | null = null;
    try {
      bank = parseBank(this.bank.value);
      map = parseMap(this.map.value);
    } catch {
      const current = currentMap(this.host.state);
      bank = current?.bank ?? null;
      map = current?.map ?? null;
    }
    const index = await openNewScriptDialog(this.host.state, { bank, map, name: this.selected < 0 ? this.name.value : null });
    if (index !== null) this.select(index);
  }
}
