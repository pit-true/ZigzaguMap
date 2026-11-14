/**
 * スクリプトの命令表。プロジェクトの xse_commands.s のマクロを正とし、commands.csv の説明（detail / hover）を足す。
 * ND と Chronos で 0F などの命令の長さが違うので、命令表はいつもプロジェクトのファイルから作る。
 */

import {
  type CommandArgumentKind,
  type CommandArgumentRole,
  type CommandArgumentShape,
  inferCommandArgumentRole,
} from "./argumentKinds.js";
import { type CommandCsvEntry, parseCommandCsv } from "./CommandCsv.js";
import { evaluateMacroExpression } from "./macroExpression.js";
import { type MacroDataSize, type MacroDefinition, parseMacroFile } from "./MacroFile.js";
import { buildMacroLayout, findMissingMacroCalls, type MacroLayout, type MacroMissingCall, type MacroVariant } from "./MacroLayout.js";

/** 命令の引数 1 つ。 */
export interface CommandArgument extends CommandArgumentRole {
  name: string;
  /** 引数の番号（0 始まり）。 */
  index: number;
  required: boolean;
  defaultValue?: string;
  vararg: boolean;
  /** 本文でそのまま書く大きさ（バイト。重なりなし）。式の中でだけ使うなら空。 */
  sizes: MacroDataSize[];
  /** 本文で 4 バイトのまま書く（ポインタ）。 */
  pointer: boolean;
}

/** 命令 1 つ。 */
export interface ScriptCommand {
  name: string;
  /** macro は xse_commands.s のマクロ、csv は CSV にだけある名前。 */
  source: "macro" | "csv";
  /** 元のマクロ。CSV だけなら null。 */
  macro: MacroDefinition | null;
  /** マクロの直前のコメント（上から順）。 */
  description: string[];
  args: CommandArgument[];
  /** バイトの並び。CSV だけか、読めないマクロなら null。 */
  layout: MacroLayout | null;
  /** マクロが読めなかった理由。読めたか CSV だけなら null。 */
  error: string | null;
  /**
   * 呼び出しをたどった先で定義の無いマクロ（`giveitem` → `copyvarifnotzero` → `setorcopyvar` なら setorcopyvar）。
   * 1 つでもあれば、この命令は GNU as で組めない。CSV だけなら空。
   */
  missingCalls: readonly MacroMissingCall[];
  /** 同じ名前の CSV の行（CSV の順）。 */
  csv: CommandCsvEntry[];
  /** 命令番号の合う CSV の行の detail（無ければ最初の行、CSV に無ければ空）。 */
  detail: string;
  /** detail と同じ行の hover（Markdown）。 */
  hover: string;
}

/** 命令表を作るときに読めなかった箇所。 */
export interface ScriptCommandProblem {
  file: "xse_commands" | "csv";
  /** マクロか CSV の行の名前。分からなければ null。 */
  name: string | null;
  line: number;
  reason: string;
}

/** 命令表を作る材料（ファイルの中身の文字列）。 */
export interface ScriptCommandTableSource {
  /** xse_commands.s の中身。 */
  xseCommands: string;
  /** commands.csv の中身。無ければ null か省略（マクロのコメントだけになる）。 */
  csv?: string | null;
  /** 定数を読むファイル（xse_defines.s・asm_defines.s など）の中身。`.equ` だけ使う。 */
  defines?: readonly string[];
}

/** 命令番号から引いた命令と型。 */
export interface ScriptCommandMatch {
  command: ScriptCommand;
  variant: MacroVariant;
}

/** 名前の比較に使う形（GNU as と同じく大文字小文字を区別しない）。 */
const keyOf = (name: string) => name.toLowerCase();

/** スクリプトの命令表。 */
export class ScriptCommandTable {
  /** xse_commands.s のマクロ（ファイルの順。読めないものも含む）。 */
  readonly commands: readonly ScriptCommand[];
  /** CSV にだけある名前（`#Org`・`[Player]`・`'Message` など。CSV の順）。 */
  readonly csvOnly: readonly ScriptCommand[];
  /** 読めなかったマクロ・CSV の行と理由。 */
  readonly problems: readonly ScriptCommandProblem[];

  private readonly byName: Map<string, ScriptCommand>;
  private readonly byOpcode: Map<number, ScriptCommandMatch[]>;
  private readonly constantText: Map<string, string>;
  private readonly constantCache = new Map<string, number | null>();

  private constructor(
    commands: ScriptCommand[],
    csvOnly: ScriptCommand[],
    problems: ScriptCommandProblem[],
    constantText: Map<string, string>,
  ) {
    this.commands = commands;
    this.csvOnly = csvOnly;
    this.problems = problems;
    this.constantText = constantText;
    this.byName = new Map();
    for (const c of [...commands, ...csvOnly]) if (!this.byName.has(keyOf(c.name))) this.byName.set(keyOf(c.name), c);
    this.byOpcode = new Map();
    for (const command of commands) {
      for (const variant of command.layout?.variants ?? []) {
        if (variant.opcode === null) continue;
        const list = this.byOpcode.get(variant.opcode) ?? [];
        list.push({ command, variant });
        this.byOpcode.set(variant.opcode, list);
      }
    }
  }

  /** ファイルの中身から命令表を作る。読めない箇所は problems に出し、例外は投げない。 */
  static build(source: ScriptCommandTableSource): ScriptCommandTable {
    const file = parseMacroFile(source.xseCommands);
    const problems: ScriptCommandProblem[] = file.problems.map((p) => ({ file: "xse_commands", ...p }));

    const constantText = new Map<string, string>();
    for (const text of source.defines ?? []) for (const [k, v] of parseMacroFile(text).constants) constantText.set(k, v);
    for (const [k, v] of file.constants) constantText.set(k, v);

    const csv = source.csv ? parseCommandCsv(source.csv) : { entries: [], problems: [] };
    for (const p of csv.problems) problems.push({ file: "csv", name: null, ...p });
    const csvByName = new Map<string, CommandCsvEntry[]>();
    for (const e of csv.entries) {
      const list = csvByName.get(keyOf(e.name)) ?? [];
      list.push(e);
      csvByName.set(keyOf(e.name), list);
    }

    const macros = new Map(file.macros.map((m) => [keyOf(m.name), m]));
    // 定数は命令表を作る前から引けるように、仮の表で計算する。
    const table = new ScriptCommandTable([], [], [], constantText);
    const context = {
      findMacro: (name: string) => macros.get(keyOf(name)),
      resolveConstant: (name: string) => table.resolveConstant(name),
    };

    const commands: ScriptCommand[] = file.macros.map((macro) => {
      const result = buildMacroLayout(macro, context);
      const layout = "layout" in result ? result.layout : null;
      const error = "error" in result ? result.error : null;
      if (error !== null && macro.body !== null) problems.push({ file: "xse_commands", name: macro.name, line: macro.line, reason: error });
      const entries = csvByName.get(keyOf(macro.name)) ?? [];
      const best = pickCsvEntry(entries, layout?.opcodes[0] ?? null);
      return {
        name: macro.name,
        source: "macro",
        macro,
        description: macro.comment,
        args: buildArguments(macro, layout),
        layout,
        error,
        missingCalls: findMissingMacroCalls(macro, context.findMacro),
        csv: entries,
        detail: best?.detail ?? "",
        hover: best?.hover ?? "",
      };
    });

    const csvOnly: ScriptCommand[] = [];
    for (const [key, entries] of csvByName) {
      if (macros.has(key)) continue;
      const first = entries[0]!;
      csvOnly.push({
        name: first.name,
        source: "csv",
        macro: null,
        description: [],
        args: [],
        layout: null,
        error: null,
        missingCalls: [],
        csv: entries,
        detail: first.detail,
        hover: first.hover,
      });
    }

    return new ScriptCommandTable(commands, csvOnly, problems, constantText);
  }

  /** 名前（大文字小文字を区別しない）から命令を引く。マクロが先、無ければ CSV だけの名前。 */
  get(name: string): ScriptCommand | undefined {
    return this.byName.get(keyOf(name));
  }

  /** 命令番号から、その番号で始まる命令と型を引く（ファイルの順。別名のマクロも全部入る）。 */
  findByOpcode(opcode: number): readonly ScriptCommandMatch[] {
    return this.byOpcode.get(opcode) ?? [];
  }

  /**
   * 組めると分かっている命令か。xse_commands.s のマクロで、呼び先がすべて定義されていて、バイトの並びまで展開できたもの。
   * 長さは `get(name).layout` の size（型で違えば minSize / maxSize）。
   */
  canAssemble(name: string): boolean {
    const c = this.get(name);
    return c !== undefined && c.source === "macro" && c.layout !== null && c.missingCalls.length === 0;
  }

  /** 読めた（バイトの並びの分かる）マクロの数。 */
  get parsedCount(): number {
    return this.commands.filter((c) => c.layout !== null).length;
  }

  /** `.equ` の定数を数にする。知らなければ null。 */
  resolveConstant(name: string): number | null {
    if (this.constantCache.has(name)) return this.constantCache.get(name)!;
    const text = this.constantText.get(name);
    if (text === undefined) return null;
    this.constantCache.set(name, null); // 自分を参照する定数で止まらないように。
    const value = evaluateMacroExpression(text, (n) => this.resolveConstant(n));
    this.constantCache.set(name, value);
    return value;
  }

  /** 型に合う CSV の行（命令番号が同じもの。無ければ最初の行）。 */
  csvForVariant(command: ScriptCommand, variant: MacroVariant): CommandCsvEntry | null {
    return pickCsvEntry(command.csv, variant.opcode);
  }
}

/** 命令番号の合う CSV の行。無ければ最初の行。 */
function pickCsvEntry(entries: readonly CommandCsvEntry[], opcode: number | null): CommandCsvEntry | null {
  return (opcode !== null ? entries.find((e) => e.opcode === opcode) : undefined) ?? entries[0] ?? null;
}

/** マクロの引数に、本文での大きさと種類・役割を付ける。 */
function buildArguments(macro: MacroDefinition, layout: MacroLayout | null): CommandArgument[] {
  const shapes: CommandArgumentShape[] = macro.params.map((p, index) => {
    const sizes: MacroDataSize[] = [];
    for (const v of layout?.variants ?? []) {
      for (const f of v.fields) if (f.kind === "arg" && f.paramIndex === index && !sizes.includes(f.size)) sizes.push(f.size);
    }
    return { name: p.name, index, pointer: sizes.includes(4), sizes };
  });
  return macro.params.map((p, index) => {
    const shape = shapes[index]!;
    return {
      ...inferCommandArgumentRole(macro.name, shape, shapes),
      name: p.name,
      index,
      required: p.required,
      ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {}),
      vararg: p.vararg,
      sizes: shape.sizes as MacroDataSize[],
      pointer: shape.pointer,
    };
  });
}

/** 引数の並びの書き方（拡張と同じ。省けるものは `[名前]`、既定値は `[名前=値]`）。 */
export function formatCommandSignature(command: ScriptCommand): string {
  return command.args
    .map((a) => (a.defaultValue !== undefined ? `[${a.name}=${a.defaultValue}]` : a.required ? a.name : `[${a.name}]`))
    .join(" ");
}

/**
 * 命令名のホバーの Markdown（拡張と同じ組み立て）。
 * CSV の hover があればそれに Signature と Source を足す。無ければマクロの名前・引数・直前のコメント。
 * sourcePath はマクロのファイルの表示名（例 `xse_commands.s`）。
 */
export function formatCommandHover(command: ScriptCommand, sourcePath = "xse_commands.s"): string {
  const signature = formatCommandSignature(command);
  const source = command.macro ? `Source: \`${sourcePath}:${command.macro.line}\`` : null;
  if (command.hover !== "") {
    let md = command.hover;
    if (command.macro) md += `\n\nSignature: \`${command.name}${signature ? ` ${signature}` : ""}\`  \n${source}`;
    return md;
  }
  let md = `**${command.name}**${signature ? ` \`${signature}\`` : ""}`;
  if (command.description.length > 0) md += `\n\n${command.description.join("\n")}`;
  if (source) md += `\n\n${source}`;
  return md;
}

/**
 * 書いた値に合わせて、引数の種類を決め直す（ホバーや色付けで使う）。
 * 文字列らしい引数でも、値が文字列のラベルでなければ、数なら定数、名前ならラベルにする。
 * 逆に、ポインタの引数の値が文字列のラベルなら文字列にする。
 */
export function resolveCommandArgumentKind(
  arg: CommandArgument,
  value: string,
  isStringLabel: (label: string) => boolean,
): CommandArgumentKind {
  const text = value.trim();
  if (arg.pointer && isStringLabel(text)) return "string";
  if (arg.kind !== "string") return arg.kind;
  if (/^-?(0x[0-9a-f]+|\d+)$/i.test(text)) return "constant";
  return "label";
}
