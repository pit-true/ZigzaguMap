import {
  AssignEventLabelsCommand,
  NEW_SCRIPT_FILE_TEXT,
  NEW_STRINGS_FILE_TEXT,
  asmBlockText,
  eventScriptTemplate,
  loadScriptConfig,
  newScriptLabel,
  replaceMapScriptTable,
  scriptLabelMapName,
  stringsBlockText,
  type AddedEvents,
  type Command,
  type CommandEvent,
  type EventLabelSavePlan,
  type EventLabelTarget,
  type LoadedScriptConfig,
  type ScriptTemplate,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import type { ProjectSession } from "../../app/ProjectSession";
import { jaScriptLink as t } from "../../i18n/ja.scriptLink";
import { ScriptFiles } from "./ScriptFiles";

/** 書き足した文字列 1 つ（取り消しで探して除く）。 */
interface TextEdit {
  readonly path: string;
  /** 足すまとまり。 */
  readonly block: string;
  /** 無いファイルのときに作る本文。 */
  readonly create: string;
  /** 実際に足した文字列（足し終わってから決まる）。 */
  added: Promise<string | null>;
}

/** ラベルを付けたイベント 1 つ。 */
interface Assigned {
  readonly target: EventLabelTarget;
  readonly index: number;
  readonly label: string;
}

const KIND_OF: Readonly<Record<EventLabelTarget, "person" | "sign" | "tile">> = { person: "person", sign: "sign", tile: "tile" };

/**
 * メインウィンドウのスクリプト連携（#202 のひな形、#208 の表の書き出し、#207 の取り込みの書き足し）。
 *
 * - イベントを置いたとき（`addEvent`・`setEventCounts` で増えたとき）に、ラベルを自動で付け、ひな形をすぐ `.s` と `.string` に書く。
 *   ラベルは置いたコマンドと一緒に元に戻る。元に戻したとき、ひな形に手が入っていなければ `.s` と `.string` から除く。
 * - マップの `.s` が maps\scripts.json に無ければ、ファイル名の入力（#201）を出し、作ったあとにラベルとひな形を付ける
 *   （`assignEventLabels`。これも元に戻せる）。
 * - 書き足しはエディタで開いているファイルならエディタの本文へ送る（ScriptFiles）。
 */
export class ScriptLink {
  readonly files: ScriptFiles;
  private session: ProjectSession | null = null;
  private config: Promise<LoadedScriptConfig | null> = Promise.resolve(null);
  private loadedConfig: LoadedScriptConfig | null = null;
  private unsubscribe: (() => void) | null = null;
  /** コマンドごとの書き足し（取り消しで除く）。 */
  private readonly edits = new WeakMap<Command, TextEdit[]>();
  /** イベントを置いたコマンドで付けたラベル（やり直しで同じ名前にする）。 */
  private readonly assigned = new WeakMap<Command, Assigned[]>();
  /** 書き足しが済んだら決まるもの（自動操作と出力が待つ）。 */
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly app: App) {
    this.files = new ScriptFiles(app);
  }

  /** 開いたセッションにつなぐ。 */
  attach(session: ProjectSession | null): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = session;
    this.loadedConfig = null;
    this.files.forget();
    if (!session?.projectDir) {
      this.config = Promise.resolve(null);
      return;
    }
    this.config = loadScriptConfig(session.files).catch(() => null);
    void this.config.then((c) => {
      if (this.session === session) this.loadedConfig = c;
    });
    session.labelHooks = { added: (events, command) => this.added(session, events, command) };
    session.writeTables = (tables) => this.writeTables(tables);
    this.unsubscribe = session.bus.subscribe((e) => this.onCommand(e));
  }

  /** 読み終わっている設定（まだなら null）。 */
  configNow(): LoadedScriptConfig["config"] | null {
    return this.loadedConfig?.config ?? null;
  }

  /** ラベルの定義をエディタで開く（索引で引く）。 */
  async openLabel(label: string): Promise<boolean> {
    const host = await this.app.scriptHost();
    return host.openLabel(label);
  }

  /** 設定（zigzagumap.json。読めなければ null）。 */
  scriptConfig(): Promise<LoadedScriptConfig | null> {
    return this.config;
  }

  /** 書き足しが全部済むまで待つ。 */
  settle(): Promise<unknown> {
    return this.pending;
  }

  // ---- イベントを置いたとき ----

  private added(session: ProjectSession, events: AddedEvents, command: Command): void {
    const store = session.labels.store;
    const { bank, map } = events.map;
    const again = this.assigned.get(command);
    const resolved = session.scriptsTable.document.resolve(bank, map);
    const config = this.loadedConfig?.config;
    if (!resolved || !config) {
      if (!again && !resolved) this.askScriptFile(session, events);
      return;
    }
    const list: Assigned[] = again ? again.filter((a) => a.target === events.target && a.index >= events.from && a.index < events.to) : [];
    if (!again) {
      const known = this.files.cachedLabels(resolved.script) ?? [];
      const used = store.usedLabels();
      const taken = (name: string): boolean => used.has(name) || known.includes(name) || list.some((a) => a.label === name);
      for (let i = events.from; i < events.to; i++) {
        if (store.label(bank, map, events.target, i)) continue;
        const name = newScriptLabel(config.labelTemplate, { map: scriptLabelMapName(resolved.script, bank, map), kind: KIND_OF[events.target], index: i }, taken);
        list.push({ target: events.target, index: i, label: name });
      }
      this.assigned.set(command, [...(this.assigned.get(command) ?? []), ...list]);
    }
    for (const a of list) store.set(bank, map, a.target, a.index, { label: a.label, kind: a.target === "person" ? "npc" : a.target });
    const templates = list.map((a) => eventScriptTemplate(KIND_OF[a.target], a.label, { dialect: config.dialect, useGlobal: config.useGlobal }));
    this.write(command, resolved.script, resolved.strings, templates, again !== undefined);
  }

  /** マップの `.s` が無いとき: ファイル名の入力を出し、作ったら置いたイベントにラベルとひな形を付ける。 */
  private askScriptFile(session: ProjectSession, events: AddedEvents): void {
    const { bank, map } = events.map;
    this.app.state.setStatus(t.noScriptFile(bank, map));
    void (async () => {
      const { ensureScriptFile } = await import("./NewScriptDialog");
      const resolved = await ensureScriptFile(this.app.state, bank, map);
      const config = (await this.config)?.config;
      if (!resolved || !config || this.session !== session) return;
      await this.files.labelsOf(resolved.script);
      const store = session.labels.store;
      const used = store.usedLabels();
      const known = this.files.cachedLabels(resolved.script) ?? [];
      const out: { target: EventLabelTarget; index: number; label: string }[] = [];
      for (let i = events.from; i < events.to; i++) {
        if (store.label(bank, map, events.target, i)) continue;
        const taken = (name: string): boolean => used.has(name) || known.includes(name) || out.some((a) => a.label === name);
        out.push({ target: events.target, index: i, label: newScriptLabel(config.labelTemplate, { map: scriptLabelMapName(resolved.script, bank, map), kind: KIND_OF[events.target], index: i }, taken) });
      }
      if (out.length > 0) this.execute(new AssignEventLabelsCommand({ bank, map, events: out, template: true }));
    })();
  }

  /** コマンドを実行する（失敗はステータスバーに出して false）。 */
  execute(command: Command): boolean {
    const bus = this.session?.bus;
    if (!bus) return false;
    try {
      bus.execute(command);
      return true;
    } catch (e) {
      this.app.state.setStatus(e instanceof Error ? e.message : String(e), undefined, true);
      return false;
    }
  }

  /** CommandBus の出来事: 取り消しで書き足しを除き、やり直しで書き直す（イベントを置いたコマンドは `added` が書き直す）。 */
  private onCommand(e: CommandEvent): void {
    const command = e.command;
    const session = this.session;
    if (!command || !session) return;
    if (e.type === "undo") {
      const edits = this.edits.get(command);
      if (edits) void this.track(this.removeEdits(edits));
      return;
    }
    if (command.name !== AssignEventLabelsCommand.NAME || command.args["template"] !== true) {
      if (e.type === "redo" && !this.assigned.has(command)) {
        const edits = this.edits.get(command);
        if (edits) void this.track(this.reapply(edits));
      }
      return;
    }
    // .s を作ったあとのひな形（assignEventLabels）
    const args = command.args as unknown as { bank: number; map: number; events: Assigned[] };
    const resolved = session.scriptsTable.document.resolve(args.bank, args.map);
    const config = this.loadedConfig?.config;
    if (!resolved || !config) return;
    const templates = args.events.map((a) => eventScriptTemplate(KIND_OF[a.target], a.label, { dialect: config.dialect, useGlobal: config.useGlobal }));
    this.write(command, resolved.script, resolved.strings, templates, e.type === "redo");
  }

  /** ひな形を `.s` と `.string` に書き足し、取り消し用に覚える。 */
  private write(command: Command, script: string, strings: string, templates: readonly ScriptTemplate[], redo: boolean): void {
    if (templates.length === 0) return;
    const before = redo ? this.edits.get(command) : undefined;
    if (before) {
      void this.track(this.reapply(before));
      return;
    }
    const edits: TextEdit[] = [];
    const asm = templates.flatMap((tp) => ["", ...tp.asm]).slice(1);
    const textLines = templates.flatMap((tp) => tp.strings);
    edits.push(this.makeEdit(script, (nl) => asmBlockText(asm, nl), NEW_SCRIPT_FILE_TEXT));
    if (textLines.length > 0) edits.push(this.makeEdit(strings, (nl) => stringsBlockText(textLines, nl), NEW_STRINGS_FILE_TEXT));
    this.edits.set(command, [...(this.edits.get(command) ?? []), ...edits]);
    const labels = templates.map((tp) => tp.label);
    void this.track(
      Promise.all(edits.map((x) => x.added)).then((added) => {
        if (added.every((a) => a !== null)) this.app.state.setStatus(t.templateWritten(labels, script));
      }),
    );
  }

  private makeEdit(path: string, block: (newline: string) => string, create: string): TextEdit {
    const edit: TextEdit = { path, block: "", create, added: Promise.resolve(null) };
    edit.added = this.files
      .read(path)
      .then((loaded) => {
        const text = loaded?.text ?? create;
        const nl = text.includes("\r\n") ? "\r\n" : "\n";
        (edit as { block: string }).block = block(nl);
        return this.files.append(path, edit.block, create);
      })
      .catch((e: unknown) => {
        this.app.state.setStatus(t.writeFailed(path, e instanceof Error ? e.message : String(e)), undefined, true);
        return null;
      });
    return edit;
  }

  private async removeEdits(edits: readonly TextEdit[]): Promise<void> {
    const kept: string[] = [];
    for (const e of [...edits].reverse()) {
      const added = await e.added;
      if (added === null) continue;
      if (!(await this.files.remove(e.path, added))) kept.push(e.path);
    }
    this.app.state.setStatus(kept.length > 0 ? t.templateKept(kept) : t.templateRemoved);
  }

  private async reapply(edits: TextEdit[]): Promise<void> {
    for (const e of edits) {
      await e.added;
      e.added = this.files.append(e.path, e.block, e.create).catch(() => null);
      await e.added;
    }
    this.app.state.setStatus(t.templateRewritten(edits.map((e) => e.path)));
  }

  /** 取り込み（#207）などで書き足したものを、コマンドに結び付ける（取り消しで除き、やり直しで書き直す）。 */
  attachEdits(command: Command, list: readonly { path: string; block: string; create: string; added: string }[]): void {
    this.edits.set(
      command,
      list.map((x) => ({ path: x.path, block: x.block, create: x.create, added: Promise.resolve(x.added) })),
    );
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending = Promise.all([this.pending, p]).catch(() => undefined);
    return p;
  }

  // ---- 出力: マップスクリプトの表 ----

  private async writeTables(tables: EventLabelSavePlan["tables"]): Promise<{ written: string[]; removed: string[] }> {
    const session = this.session;
    const written: string[] = [];
    if (!session) return { written, removed: [] };
    const config = (await this.config)?.config;
    for (const x of tables) {
      const resolved = session.scriptsTable.document.resolve(x.bank, x.map);
      if (!resolved) throw new Error(t.tableNoScript(x.bank, x.map));
      await this.files.change(
        resolved.script,
        (text) => {
          let next = text;
          if (x.previous && x.previous !== x.table?.label) next = replaceMapScriptTable(next, x.previous, null, false);
          return replaceMapScriptTable(next, x.table?.label ?? x.label, x.table, config?.useGlobal ?? false);
        },
        { create: NEW_SCRIPT_FILE_TEXT, save: true },
      );
      written.push(resolved.script);
    }
    return { written, removed: [] };
  }
}
