import {
  AddEventCommand,
  CommandGroup,
  SetEventFieldsCommand,
  SetItemBallCommand,
  checkTemplateValues,
  checkTextWidth,
  eventTemplate,
  parseWidthRegistryListing,
  planWidthRegistry,
  readTextIfExists,
  templateFields,
  templateItemBall,
  templateLabelName,
  templateScript,
  type Command,
  type CommandEvent,
  type EventTemplateId,
  type MapId,
  type TemplateValues,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import { cloneSyncFor, reportClones } from "../../app/cloneSync";
import { jaTemplate as t } from "../../i18n/ja.template";
import { ProcessRunner } from "../../util/processRunner";
import { disasmTools } from "../script/disasmTools";

/** ひな形を置く指定。 */
export interface TemplatePlaceRequest {
  readonly kind: EventTemplateId;
  readonly x: number;
  readonly y: number;
  readonly values: TemplateValues;
}

/** 置いた結果。 */
export interface TemplatePlaceResult {
  readonly kind: EventTemplateId;
  readonly map: MapId;
  /** 置いたイベントの種類と番号。 */
  readonly event: { readonly kind: "person" | "sign" | "trap"; readonly index: number };
  /** 付けたラベル（スクリプトの無いひな形なら null）。 */
  readonly label: string | null;
  /** `.s` と `.string`（スクリプトの無いひな形なら null）。 */
  readonly script: string | null;
  readonly strings: string | null;
  /** 幅検査の登録に足した文字列（Chronos）。 */
  readonly registry: readonly string[];
  /** 知らせ（同じトレーナーの番号をほかで使っているなど）。 */
  readonly warnings: readonly string[];
  /** 置いたコマンド。 */
  readonly command: Command;
}

/** 置く前に、ひな形にほかの書き込みを足すもの（#245 のトレーナーの表など）。 */
export interface TemplateExtension {
  /** 置くコマンドの前に足すコマンド（同じ 1 回の取り消しにまとめる）。無ければ空。 */
  commands(request: TemplatePlaceRequest, map: MapId): Promise<Command[]> | Command[];
}

/**
 * ひな形（#243・#244）を置く。イベントの追加・欄の値・（落とし物の人なら）落とし物・ラベル・`.s` と `.string` の書き足しを
 * 1 つの CommandGroup にまとめ、1 回の取り消しで全部戻す（ラベルと書き足しは ScriptLink がコマンドに結び付ける）。
 * Chronos は、書き足した `.string` の新しい `#org` を幅検査の登録（`widthRegistry`）にも足す（エディタで保存したときと同じ規則）。
 */
export class TemplatePlacer {
  /** 幅検査の登録の書き換え（取り消しで戻す）。 */
  private readonly registryEdits = new WeakMap<Command, { path: string; before: string | null; after: string }>();
  private unsubscribe: (() => void) | null = null;
  private readonly extensions: TemplateExtension[] = [];

  constructor(private readonly app: App) {
    const attach = (): void => {
      this.unsubscribe?.();
      this.unsubscribe = app.state.session?.bus.subscribe((e) => this.onCommand(e)) ?? null;
    };
    app.state.on("session", attach);
    attach();
  }

  /** ほかの書き込みを足す（#245）。 */
  extend(extension: TemplateExtension): void {
    this.extensions.push(extension);
  }

  /** 置く。置けなければ Error（理由つき）。 */
  async place(request: TemplatePlaceRequest): Promise<TemplatePlaceResult> {
    const app = this.app;
    const session = app.state.session;
    const map = app.state.map?.id;
    if (!session || !map) throw new Error(t.noMap);
    const spec = eventTemplate(request.kind);
    const values = request.values;
    checkTemplateValues(request.kind, values);
    const config = (await app.scripts.scriptConfig())?.config ?? null;
    for (const x of spec.texts) {
      const text = values.texts?.[x.key] ?? x.text;
      // 簡易の幅検査（zigzagumap.json の lineMaxChars / linesPerPage。既定 18 字・2 行）
      const issue = checkTextWidth(text, config ? { maxColumns: config.lineMaxChars, maxLines: config.linesPerPage } : {}).issues[0];
      const what = t.texts[x.key] ?? x.key;
      if (issue?.kind === "columns") throw new Error(t.tooWide(what, issue.line + 1, issue.columns, issue.limit));
      if (issue) throw new Error(t.tooManyLines(what, issue.page + 1, issue.line + 1, issue.limit));
    }
    const hasScript = spec.labelKind !== null;
    let resolved: { script: string; strings: string } | null = null;
    if (hasScript) {
      if (!session.projectDir || !config) throw new Error(t.needProject);
      const { ensureScriptFile } = await import("../script/NewScriptDialog");
      resolved = await ensureScriptFile(app.state, map.bank, map.map);
      if (!resolved) throw new Error(t.failed(t.needProject));
      // ラベルが重ならないよう、.s のラベルの一覧を先に読んでおく
      await app.scripts.files.labelsOf(resolved.script);
    }
    const doc = await session.project.load(map);
    // 落とし物は、見えるボールで置くときだけ人（ほかは看板の隠しアイテム）
    const list = request.kind === "hiddenItem" ? (values.ball ? "persons" : "signs") : spec.kind === "trap" ? "traps" : spec.kind === "sign" ? "signs" : "persons";
    const kind = list === "signs" ? "sign" : list === "traps" ? "trap" : "person";
    const index = doc.events ? doc.events[list].length : 0;
    const commands: Command[] = [];
    for (const ext of this.extensions) commands.push(...(await ext.commands(request, map)));
    commands.push(new AddEventCommand({ ...map, kind, x: request.x, y: request.y }));
    const fields = templateFields(request.kind, values);
    if (Object.keys(fields).length > 0) commands.push(new SetEventFieldsCommand({ ...map, kind, index, fields }));
    const ball = templateItemBall(request.kind, values);
    if (ball !== null) commands.push(new SetItemBallCommand({ ...map, personIndex: index, itemId: ball }));
    // 人を置いたら、隣のマップのクローンも合わせる（#242。ドラッグ・削除と同じ規則で、同じ 1 回の操作にまとめる）
    const sync = kind === "person" ? await cloneSyncFor(app.state, map) : null;
    if (sync) commands.push(sync);
    const command = CommandGroup.of(commands);
    // 同じトレーナーの番号をほかの場所でも使っていれば知らせる（#244。#227 の索引）
    const trainerId = request.kind === "trainer" ? (values.newTrainer?.id ?? values.trainerId ?? 0) : 0;
    const uses = trainerId > 0 && !values.newTrainer ? await app.usage.find("trainer", trainerId) : [];
    const warnings = uses.length > 0 ? [t.trainerUsed(`0x${trainerId.toString(16).toUpperCase()}`, uses.slice(0, 3).map((u) => u.where).join("、"))] : [];
    // アイテムをくれる人は、プロジェクトの xse_commands.s で obtainitem が組めるときだけマクロで書く
    const commandTable = hasScript && request.kind === "itemGiver" ? ((await disasmTools(session).catch(() => null))?.table ?? null) : null;
    if (config) {
      app.scripts.expectTemplate(command, {
        nameKind: spec.nameKind,
        labelKind: spec.labelKind ?? "npc",
        labelName: (base) => templateLabelName(request.kind, base),
        script: hasScript ? (label) => templateScript(request.kind, label, values, { dialect: config.dialect, useGlobal: config.useGlobal, commands: commandTable }) : null,
      });
    }
    if (!app.scripts.execute(command)) throw new Error(t.failed(app.state.status.left));
    await app.scripts.settle();
    const label = app.scripts.templateLabel(command);
    const registry = resolved && label ? await this.register(command, resolved.strings) : [];
    app.eventTabSelect(kind, index);
    const notes = [t.placed(t.kinds[request.kind] ?? request.kind, label), ...warnings];
    if (registry.length > 0 && config?.widthRegistry) notes.push(t.registry(registry.length, config.widthRegistry.path));
    app.state.setStatus(notes.join("　"), undefined, warnings.length > 0);
    if (sync) reportClones(app.state, sync.changes);
    return { kind: request.kind, map, event: { kind, index }, label, script: resolved?.script ?? null, strings: resolved?.strings ?? null, registry, warnings, command };
  }

  /** Chronos: 書き足した `.string` の新しい `#org` を幅検査の登録に足す（`check_text_width.py` の REGISTRY に載っているファイルだけ）。 */
  private async register(command: Command, stringsPath: string): Promise<string[]> {
    const config = (await this.app.scripts.scriptConfig())?.config;
    const reg = config?.widthRegistry;
    const step = config?.widthCheck;
    const fs = this.app.state.session?.files;
    if (!reg || !step || step.args.length === 0 || !fs) return [];
    try {
      const runner = await ProcessRunner.get();
      const proc = await runner.spawn({ command: step.command, args: [step.args[0]!, "--list-registry"], cwd: step.cwd }, () => {});
      await proc.done;
      const listing = parseWidthRegistryListing(proc.lines.filter((l) => l.stream === "stdout").map((l) => l.line).join("\n"));
      const text = (await this.app.scripts.files.read(stringsPath))?.text ?? "";
      const before = await readTextIfExists(fs, reg.path);
      const plan = planWidthRegistry({
        registryText: before,
        listing,
        fileKey: reg.prefix + stringsPath,
        stringText: text,
        window: reg.window,
        unresolvedReason: (buffers) => buffers,
      });
      if (plan.text === null) return [];
      await fs.writeText(reg.path, plan.text);
      this.registryEdits.set(command, { path: reg.path, before, after: plan.text });
      return [...plan.added];
    } catch {
      return [];
    }
  }

  /** 取り消し・やり直しで、幅検査の登録も戻す。 */
  private onCommand(e: CommandEvent): void {
    const edit = e.command ? this.registryEdits.get(e.command) : undefined;
    const fs = this.app.state.session?.files;
    if (!edit || !fs || (e.type !== "undo" && e.type !== "redo")) return;
    const text = e.type === "undo" ? edit.before : edit.after;
    void this.app.scripts.trackWork(text === null ? fs.remove(edit.path) : fs.writeText(edit.path, text));
  }
}
