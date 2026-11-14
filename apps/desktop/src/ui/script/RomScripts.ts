import {
  DisasmCommandSet,
  NEW_SCRIPT_FILE_TEXT,
  NEW_STRINGS_FILE_TEXT,
  ROM_BASE,
  ScriptCommandTable,
  ScriptTextCodec,
  SetEventLabelCommand,
  SetMapScriptTableCommand,
  asmBlockText,
  disassembleScripts,
  findImportedLabels,
  formatHex,
  mapScriptTableFromEntries,
  mapScriptTargetLabel,
  mapScriptTypeOfAddress,
  movementNamesFromDefines,
  newScriptLabel,
  planScriptImport,
  renderDisassembly,
  retargetMapScriptAddress,
  scriptLabelMapName,
  tableArgs,
  type MapScriptTableModel,
  type ScriptImportPlan,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaRomScript as t } from "../../i18n/ja.romScript";
import type { ScriptRomOpenRequest } from "../../windows/script-editor/protocol";
import type { ScriptTarget } from "./ScriptEntry";

const LABEL_TARGET = { person: "person", sign: "sign", trap: "tile" } as const;

/** 16 進 8 桁（`08160A8E`）。 */
function hex8(n: number): string {
  return formatHex(n >>> 0, 8);
}

/** 取り込みの計画（マップスクリプトなら、行き先を取り込んだ入口にした表も持つ）。 */
export type RomImportPlan = ScriptImportPlan & { scriptPath: string; stringsPath: string; table: MapScriptTableModel | null };

/**
 * 素の ROM のスクリプト（#206 の読み取り専用の表示、#207 の取り込み）。逆アセンブルはメインで行い（ROM はメインだけが持つ）、
 * 文字にした結果だけをエディタへ送る（ROM のバイト列は写さない）。命令表はプロジェクトの xse_commands.s から作り
 * （素の ROM だけなら同梱の表）、使うたびに作って捨てる（メインのメモリに残さない）。
 */
export class RomScripts {
  constructor(private readonly app: App) {}

  private async tools(): Promise<{ commands: DisasmCommandSet; text: ScriptTextCodec }> {
    const session = this.app.state.session;
    const fs = session?.files;
    if (!session?.projectDir || !fs) return { commands: DisasmCommandSet.bundled(), text: ScriptTextCodec.japanese };
    const read = async (path: string): Promise<string | null> => ((await fs.exists(path)) ? fs.readText(path) : null);
    const xse = await read("xse_commands.s");
    const defines = (await Promise.all(["xse_defines.s", "asm_defines.s"].map(read))).filter((x): x is string => x !== null);
    const charmap = await read("charmap.tbl");
    const text = charmap ? ScriptTextCodec.fromCharmap(charmap) : ScriptTextCodec.japanese;
    if (!xse) return { commands: DisasmCommandSet.bundled(), text };
    const table = ScriptCommandTable.build({ xseCommands: xse, defines });
    const xseDefines = await read("xse_defines.s");
    return { commands: DisasmCommandSet.fromCommandTable(table, xseDefines ? movementNamesFromDefines(xseDefines) : new Map()), text };
  }

  /** エディタへ送る、読み取り専用のタブの中身。 */
  async view(pointer: number, target: ScriptTarget | null): Promise<ScriptRomOpenRequest> {
    const session = this.app.state.session;
    if (!session) throw new Error(t.noRom);
    const offset = (pointer >>> 0) - ROM_BASE;
    if (!session.project.rom.inRange(offset)) throw new Error(t.outOfRom(hex8(pointer)));
    const { commands, text } = await this.tools();
    const d = disassembleScripts(session.project.rom, [{ offset }], { commands, text });
    const r = renderDisassembly(d);
    const lines = [t.header(hex8(pointer)), "", r.script.text.trimEnd()];
    if (r.strings.text !== "") lines.push("", t.stringsHeader, ...r.strings.text.trimEnd().split("\n").map((l) => (l === "" ? "" : `@ ${l}`)));
    if (d.problems.length > 0) lines.push("", t.problemsHeader, ...d.problems.map((p) => `@ ${p.offset === null ? "" : `0x${hex8(p.offset + ROM_BASE)}: `}${p.message}`));
    let importable = !!session.projectDir && target !== null;
    let items: ScriptRomOpenRequest["items"] = [];
    if (importable) {
      const plan = await this.plan(pointer, target!, new Map()).catch(() => null);
      items = plan?.items.map((i) => ({ kind: i.kind, pointer: i.offset + ROM_BASE, label: i.label, reused: i.reused })) ?? [];
      // マップスクリプトは、表の行き先のアドレスのときだけ取り込める
      if (target!.kind === "map" && !plan) importable = false;
    }
    return { key: `ROM:${hex8(pointer)}`, pointer: pointer >>> 0, text: `${lines.join("\n")}\n`, target, importable, items };
  }

  /**
   * 取り込みの計画（`rename` は自動で付けた名前 → 新しい名前）。
   * マップスクリプトは、マップの表で行き先がそのアドレスの件を探し、入口を `<表のラベル>_<種類>`（`Moegi_MapScripts_OnLoad`）にする。
   * 表がまだ無ければ、「表を作る」と同じ表（今の ROM のマップスクリプトをアドレスのまま）を作ってから付け替える。
   */
  async plan(pointer: number, target: ScriptTarget, rename: ReadonlyMap<string, string>): Promise<RomImportPlan> {
    const session = this.app.state.session;
    if (!session?.projectDir) throw new Error(t.noProject);
    const { bank, map } = target.map;
    const resolved = session.scriptsTable.document.resolve(bank, map);
    if (!resolved) throw new Error(t.noScriptFile(bank, map));
    const config = (await this.app.scripts.scriptConfig())?.config;
    if (!config) throw new Error(t.noConfig);
    // 前に取り込んだもの（対応表のすべての .s と .string の印）
    const existing = new Map<number, string>();
    const paths = new Set<string>();
    for (const row of session.scriptsTable.document.rows) {
      paths.add(row.entry.script);
      paths.add(row.entry.strings ?? `strings/overworld_strings_${row.entry.script.replace(/^.*\//, "").replace(/\.s$/, "")}.string`);
    }
    for (const p of paths) {
      const loaded = await this.app.scripts.files.read(p).catch(() => null);
      if (loaded) findImportedLabels(loaded.text, existing);
    }
    const host = await this.app.scriptHost();
    const known = new Set([...(await host.labelNames()), ...session.labels.store.usedLabels()]);
    const taken = (name: string): boolean => known.has(name);
    const mapName = scriptLabelMapName(resolved.script, bank, map);
    let table: MapScriptTableModel | null = null;
    let label: string;
    if (target.kind === "map") {
      const labels = session.labels.store.get(bank, map);
      if (!labels.table && labels.mapScripts) throw new Error(t.externalTable(labels.mapScripts));
      table = labels.table;
      if (!table) {
        const doc = session.project.loaded({ bank, map }) ?? (await session.project.load({ bank, map }));
        table = mapScriptTableFromEntries(newScriptLabel(config.labelTemplate, { map: mapName, kind: "map", index: 0 }, taken), doc.mapScripts ?? []);
        known.add(table.label);
      }
      const type = mapScriptTypeOfAddress(table, pointer);
      if (type === null) throw new Error(t.notMapScriptTarget(hex8(pointer)));
      label = mapScriptTargetLabel(table.label, type, taken);
    } else {
      label = newScriptLabel(config.labelTemplate, { map: mapName, kind: LABEL_TARGET[target.kind], index: target.index ?? 0 }, taken);
    }
    const { commands, text } = await this.tools();
    const plan = planScriptImport(session.project.rom, (pointer >>> 0) - ROM_BASE, {
      commands,
      text,
      dialect: config.dialect,
      useGlobal: config.useGlobal,
      label,
      existing,
      taken,
      rename,
    });
    return {
      ...plan,
      scriptPath: resolved.script,
      stringsPath: resolved.strings,
      table: table ? retargetMapScriptAddress(table, pointer, plan.entryLabel) : null,
    };
  }

  /**
   * 取り込む: `.s` と `.string` に書き足し、イベントのラベル（マップスクリプトなら表の行き先）を取り込んだ入口にする
   * （1 つのコマンド。元に戻すと、ラベルか表を戻し、手を入れていなければ書き足したものも除く）。eventscripts は出力のときに書く。
   */
  async import(pointer: number, target: ScriptTarget, rename: ReadonlyMap<string, string>): Promise<ScriptImportPlan> {
    const session = this.app.state.session;
    if (!session) throw new Error(t.noRom);
    const plan = await this.plan(pointer, target, rename);
    if (!plan.reused && plan.asm.length === 0) throw new Error(t.nothingToImport(plan.problems.join(" / ")));
    const edits: { path: string; block: string; create: string; added: string }[] = [];
    const files = this.app.scripts.files;
    if (!plan.reused) {
      const newline = (await files.read(plan.scriptPath))?.text.includes("\r\n") ? "\r\n" : "\n";
      const asm = asmBlockText(plan.asm, newline);
      edits.push({ path: plan.scriptPath, block: asm, create: NEW_SCRIPT_FILE_TEXT, added: await files.append(plan.scriptPath, asm, NEW_SCRIPT_FILE_TEXT) });
      if (plan.strings.length > 0) {
        const nl = (await files.read(plan.stringsPath))?.text.includes("\r\n") ? "\r\n" : "\n";
        const block = asmBlockText(plan.strings, nl);
        edits.push({ path: plan.stringsPath, block, create: NEW_STRINGS_FILE_TEXT, added: await files.append(plan.stringsPath, block, NEW_STRINGS_FILE_TEXT) });
      }
    }
    const { bank, map } = target.map;
    const command =
      target.kind === "map"
        ? new SetMapScriptTableCommand({ bank, map, table: tableArgs(plan.table) })
        : new SetEventLabelCommand({ bank, map, target: LABEL_TARGET[target.kind], index: target.index ?? 0, label: plan.entryLabel });
    if (!this.app.scripts.execute(command)) {
      for (const e of edits) await files.remove(e.path, e.added);
      throw new Error(this.app.state.status.left);
    }
    this.app.scripts.attachEdits(command, edits);
    this.app.state.setStatus(plan.reused ? t.reused(plan.entryLabel) : t.imported(plan.entryLabel, plan.scriptPath));
    return plan;
  }
}
