/**
 * スクリプトエディタの補助（色付け・ホバー・補完・定義へ移動・波線）の元になる、プロジェクトの知識。
 * 命令表（xse_commands.s と commands.csv）、ラベルと `.equ` の索引（assembly/**\/*.s と直下の 3 ファイル）、
 * 文字列のラベルの索引（strings/*.string）をまとめて持つ。DOM を使わない（Node のテストから呼べる）。
 *
 * 行の解析は `.s` の 1 行の解析（AsmLine）を使い、命令の引数の種類は命令表の推定（argumentKinds）に、
 * 書いた値（文字列のラベルか、数か）を合わせて決める（拡張の inferArgumentInfo と同じ考え方）。
 */

import { asmOpName, asmTokenText, parseAsmLine, type AsmLine, type AsmToken } from "../asm/AsmLine.js";
import { evaluateMacroExpression } from "../commands/macroExpression.js";
import {
  resolveCommandArgumentKind,
  type CommandArgument,
  type ScriptCommand,
  type ScriptCommandTable,
} from "../commands/ScriptCommandTable.js";
import type { CommandArgumentKind } from "../commands/argumentKinds.js";
import type { ScriptEqu } from "../index/ScriptFileIndex.js";
import { ScriptIndex } from "../index/ScriptIndex.js";
import { ScriptStringIndex } from "./ScriptStringIndex.js";
import { isThumbMnemonic } from "./thumbMnemonics.js";

/** 命令・ディレクティブの種類。 */
export type AsmOpKind =
  /** 命令表（マクロ）にある命令。 */
  | "command"
  /** ARM / Thumb の命令。 */
  | "instruction"
  /** `.` で始まるディレクティブ。 */
  | "directive"
  /** 同じファイルの `.macro` で書いた命令。 */
  | "localMacro"
  /** どれでもない。 */
  | "unknown";

/** 解析した引数 1 つ。 */
export interface AnalyzedArg {
  readonly token: AsmToken;
  readonly text: string;
  readonly index: number;
  /** 値に合わせて決めた種類。決められなければ null（Thumb の命令の引数など）。 */
  readonly kind: CommandArgumentKind | null;
  /** 命令表から推定した種類（値を見る前）。命令表の命令でなければ null。 */
  readonly declaredKind: CommandArgumentKind | null;
  /** 役割（ホバーに出す説明）。 */
  readonly role: string | null;
  /** 命令表の引数。命令表の命令でなければ null。 */
  readonly argument: CommandArgument | null;
}

/** 解析した 1 行。 */
export interface AnalyzedLine {
  readonly line: AsmLine;
  /** 命令・ディレクティブの名前（ディレクティブは小文字）。 */
  readonly opName: string | null;
  readonly opKind: AsmOpKind | null;
  readonly command: ScriptCommand | null;
  readonly args: readonly AnalyzedArg[];
}

/** 数に直した `.equ`。 */
export interface EquValue {
  readonly equ: ScriptEqu;
  readonly value: number | null;
}

/** 補完に出すディレクティブ。 */
export const ASM_DIRECTIVES: readonly string[] = [
  ".align", ".ascii", ".byte", ".2byte", ".4byte", ".hword", ".word", ".string", ".equ", ".set", ".global",
  ".include", ".text", ".thumb", ".thumb_func", ".macro", ".endm", ".if", ".ifdef", ".ifndef", ".else", ".endif",
];

/** データを並べるディレクティブ（引数はラベル・定数・移動の名前）。 */
const DATA_DIRECTIVES = new Set([".byte", ".2byte", ".4byte", ".hword", ".short", ".word", ".long", ".int"]);

/** msgbox の種類（拡張の msgboxTypes と同じ。xse_defines.s に `MSG_*` の `.equ` があればそちらを使う）。 */
export const MSGBOX_TYPES: readonly { readonly name: string; readonly value: string; readonly description: string }[] = [
  { name: "MSG_OBTAIN", value: "0x0", description: "Obtain item message" },
  { name: "MSG_FIND", value: "0x1", description: "Find item message" },
  { name: "MSG_FACE", value: "0x2", description: "Face-to-face message" },
  { name: "MSG_SIGN", value: "0x3", description: "Sign message" },
  { name: "MSG_KEEPOPEN", value: "0x4", description: "Keep the message box open" },
  { name: "MSG_YESNO", value: "0x5", description: "Yes/No choice message" },
  { name: "MSG_NORMAL", value: "0x6", description: "Normal trainer/NPC message" },
  { name: "MSG_POKENAV", value: "0xA", description: "Pokenav message" },
];

/** 名前の決まった定数の説明（拡張の describeKnownConstant と同じ）。 */
const KNOWN_CONSTANTS: Readonly<Record<string, string>> = {
  CUSTOM_CHOICE_TOP: "customchoice の上側選択肢。LASTRESULT に 0 が返る",
  CUSTOM_CHOICE_BOTTOM: "customchoice の下側選択肢。LASTRESULT に 1 が返る",
  YES: "はい。通常は 1",
  NO: "いいえ。通常は 0",
  TRUE: "真。通常は 1",
  FALSE: "偽。通常は 0",
};

/** 名前の決まった定数の説明。知らなければ null。 */
export function describeKnownConstant(name: string): string | null {
  return KNOWN_CONSTANTS[name.toUpperCase()] ?? null;
}

/** `0x10` や `12` を数にする（式は読まない）。数でなければ null。 */
export function parseAsmInteger(text: string): number | null {
  const t = text.trim();
  if (!/^-?(?:0x[0-9a-f]+|0b[01]+|\d+)$/i.test(t)) return null;
  const neg = t.startsWith("-");
  const body = neg ? t.slice(1) : t;
  const lower = body.toLowerCase();
  const n = lower.startsWith("0x") ? Number.parseInt(lower.slice(2), 16) : lower.startsWith("0b") ? Number.parseInt(lower.slice(2), 2) : Number.parseInt(lower, 10);
  return Number.isNaN(n) ? null : neg ? -n : n;
}

/** `top_kanji` → `top` のように、ひらがな・漢字の印を外した名前。 */
export function stringArgBase(name: string): string {
  return name.toLowerCase().replace(/_?(kanji|hiragana)$/, "");
}

/** 名前に使える字か（ラベル・`.equ` の名前）。 */
export function isAsmNameChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46 || c === 36;
}

/** スクリプトエディタの補助の知識。 */
export class ScriptAssist {
  readonly index: ScriptIndex;
  readonly strings: ScriptStringIndex;
  private table: ScriptCommandTable | null;
  /** リンカのスクリプト（BPRJ.ld）などで決まる名前（`gStringVar4 = 0x2021C88;`）。 */
  private readonly external = new Set<string>();
  private versionNo = 0;
  private equCache: { version: number; values: Map<string, number | null>; byValue: Map<number, string[]> } | null = null;

  constructor(options: { commands?: ScriptCommandTable | null; index?: ScriptIndex; strings?: ScriptStringIndex } = {}) {
    this.table = options.commands ?? null;
    this.index = options.index ?? new ScriptIndex();
    this.strings = options.strings ?? new ScriptStringIndex();
  }

  /** 命令表（無ければ null）。 */
  get commands(): ScriptCommandTable | null {
    return this.table;
  }

  /** 変わるたびに増える番号。 */
  get version(): number {
    return this.versionNo + this.strings.version;
  }

  /** 命令表を入れ替える。 */
  setCommands(table: ScriptCommandTable | null): void {
    this.table = table;
    this.changed();
  }

  /** `.s` の 1 ファイルを入れ替える（編集中の本文でもよい）。 */
  updateAsm(path: string, text: string): void {
    this.index.updateFile(path, text);
    this.changed();
  }

  /** `.string` の 1 ファイルを入れ替える。 */
  updateString(path: string, text: string): void {
    this.strings.updateFile(path, text);
  }

  /** リンカのスクリプトの名前を入れ替える（`名前 = 値;` の行の名前）。 */
  setLinkerSymbols(text: string): void {
    this.external.clear();
    for (const m of text.matchAll(/^\s*([A-Za-z_.$][A-Za-z0-9_.$]*)\s*=\s*[^;=]+;/gm)) this.external.add(m[1]!);
    this.changed();
  }

  /** リンカのスクリプトで決まる名前か。 */
  isLinkerSymbol(name: string): boolean {
    return this.external.has(name);
  }

  /** ファイルの分を消す。 */
  remove(path: string): void {
    this.index.removeFile(path);
    this.strings.removeFile(path);
    this.changed();
  }

  /** 索引を変えたあとに呼ぶ（`.equ` の値の計算をやり直す）。 */
  changed(): void {
    this.versionNo++;
    this.equCache = null;
  }

  // ---- 引く ----

  /** 命令表の命令（大文字小文字を区別しない）。CSV にだけある名前（`#Org` など）は返さない。 */
  command(name: string): ScriptCommand | null {
    const c = this.table?.get(name);
    return c && c.source === "macro" ? c : null;
  }

  /** 文字列のラベルか。 */
  isStringLabel(name: string): boolean {
    return this.strings.has(name);
  }

  /** ラベル（assembly の `.s` の定義）があるか。 */
  hasLabel(name: string): boolean {
    return this.index.findLabels(name).length > 0;
  }

  /** `.equ` の定数（索引か命令表のファイル）があるか。 */
  hasConstant(name: string): boolean {
    return this.index.findEqus(name).length > 0 || (this.table?.resolveConstant(name) ?? null) !== null;
  }

  /** `.equ` の値（式を計算したもの）。知らないか計算できなければ null。 */
  constantValue(name: string): number | null {
    const cache = this.equs();
    if (cache.values.has(name)) return cache.values.get(name)!;
    return this.table?.resolveConstant(name) ?? null;
  }

  /** 値が同じ `.equ` の名前（索引の順）。 */
  constantsWithValue(value: number): readonly string[] {
    return this.equs().byValue.get(value) ?? [];
  }

  /** すべての `.equ` と値。 */
  allConstants(): EquValue[] {
    const cache = this.equs();
    return this.index.allEqus().map((equ) => ({ equ, value: cache.values.get(equ.name) ?? null }));
  }

  /**
   * msgbox の種類の名前（拡張と同じ 8 つ）。`.equ` があれば値はそちらを使う。
   * `MSG_*` の `.equ` には msgbox の種類でないもの（ND の MSG_FRIEND_LOW など）もあるので、名前は決まった 8 つだけにする。
   */
  msgboxTypes(): { name: string; value: string; description: string }[] {
    return MSGBOX_TYPES.map((t) => {
      const equ = this.index.findEqu(t.name);
      return { name: t.name, value: equ?.value ?? t.value, description: equ?.description ?? t.description };
    });
  }

  // ---- 行の解析 ----

  /** 1 行を解析し、命令と引数の種類を決める。`inBlockComment` は前の行が `/* *\/` の中で終わったか。 */
  analyze(text: string, inBlockComment = false): AnalyzedLine {
    return this.analyzeParsed(parseAsmLine(text, inBlockComment));
  }

  /** 解析済みの行から、命令と引数の種類を決める。 */
  analyzeParsed(line: AsmLine, localMacros?: ReadonlySet<string>): AnalyzedLine {
    const opName = asmOpName(line);
    if (!line.op || opName === null) return { line, opName: null, opKind: null, command: null, args: [] };
    const tokens = line.args;
    if (line.op.kind === "directive") {
      const args = tokens.map((token, index) => this.directiveArg(line, opName, token, index));
      return { line, opName, opKind: "directive", command: null, args };
    }
    const command = this.command(opName);
    if (command) {
      const args = tokens.map((token, index) => this.commandArg(line, command, token, index));
      return { line, opName, opKind: "command", command, args };
    }
    const opKind: AsmOpKind = isThumbMnemonic(opName) ? "instruction" : localMacros?.has(opName.toLowerCase()) ? "localMacro" : "unknown";
    const args = tokens.map((token, index) => this.plainArg(line, token, index));
    return { line, opName, opKind, command: null, args };
  }

  private commandArg(line: AsmLine, command: ScriptCommand, token: AsmToken, index: number): AnalyzedArg {
    const text = asmTokenText(line, token);
    const last = command.args[command.args.length - 1];
    const argument = command.args[index] ?? (last?.vararg ? last : null);
    if (!argument) return { token, text, index, kind: this.valueKind(token.kind, text), declaredKind: null, role: null, argument: null };
    let kind = resolveCommandArgumentKind(argument, text, (s) => this.isStringLabel(s));
    if (kind !== "string" && token.kind === "symbol" && this.isStringLabel(text)) kind = "string";
    return { token, text, index, kind, declaredKind: argument.kind, role: argument.role, argument };
  }

  private directiveArg(line: AsmLine, op: string, token: AsmToken, index: number): AnalyzedArg {
    const text = asmTokenText(line, token);
    let kind: CommandArgumentKind | null = null;
    if (DATA_DIRECTIVES.has(op) || op === ".equ" || op === ".set" || op === ".equiv") kind = this.valueKind(token.kind, text);
    else if ((op === ".global" || op === ".globl") && token.kind === "symbol") kind = "label";
    return { token, text, index, kind, declaredKind: null, role: null, argument: null };
  }

  private plainArg(line: AsmLine, token: AsmToken, index: number): AnalyzedArg {
    const text = asmTokenText(line, token);
    return { token, text, index, kind: null, declaredKind: null, role: null, argument: null };
  }

  /** 値だけから決める種類（ディレクティブの引数など）。 */
  private valueKind(tokenKind: AsmToken["kind"], text: string): CommandArgumentKind | null {
    if (tokenKind === "number") return "constant";
    if (tokenKind !== "symbol") return tokenKind === "expression" ? "constant" : null;
    if (this.isStringLabel(text)) return "string";
    if (this.hasLabel(text)) return "label";
    return "constant";
  }

  private equs(): { values: Map<string, number | null>; byValue: Map<number, string[]> } {
    if (this.equCache && this.equCache.version === this.versionNo) return this.equCache;
    const text = new Map<string, string>();
    for (const e of this.index.allEqus()) if (!text.has(e.name)) text.set(e.name, e.value);
    const values = new Map<string, number | null>();
    const resolve = (name: string): number | null => {
      if (values.has(name)) return values.get(name)!;
      const expr = text.get(name);
      if (expr === undefined) return this.table?.resolveConstant(name) ?? null;
      values.set(name, null);
      const v = evaluateMacroExpression(expr, resolve);
      values.set(name, v);
      return v;
    };
    const byValue = new Map<number, string[]>();
    for (const name of text.keys()) {
      const v = resolve(name);
      if (v === null) continue;
      const list = byValue.get(v);
      if (list) list.push(name);
      else byValue.set(v, [name]);
    }
    this.equCache = { version: this.versionNo, values, byValue };
    return this.equCache;
  }
}

/** 本文の `.macro 名前` の名前（小文字）。 */
export function localMacroNames(lines: readonly AsmLine[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) {
    if (asmOpName(line) !== ".macro") continue;
    const first = line.args[0];
    if (first) out.add(asmTokenText(line, first).toLowerCase().replace(/[,\s].*$/, ""));
  }
  return out;
}

/** 行の中で、桁 `column` を含む名前の範囲（名前でなければ null）。 */
export function asmWordAt(text: string, column: number): { start: number; end: number } | null {
  let start = column;
  while (start > 0 && isAsmNameChar(text.charCodeAt(start - 1))) start--;
  let end = column;
  while (end < text.length && isAsmNameChar(text.charCodeAt(end))) end++;
  return end > start ? { start, end } : null;
}
