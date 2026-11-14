import { asmTokenText } from "../asm/AsmLine.js";
import { describeScriptVariable } from "../commands/argumentKinds.js";
import type { ScriptCommand } from "../commands/ScriptCommandTable.js";
import type { ScriptEqu, ScriptLabel } from "../index/ScriptFileIndex.js";
import {
  describeKnownConstant,
  parseAsmInteger,
  stringArgBase,
  type AnalyzedArg,
  type AnalyzedLine,
  type ScriptAssist,
} from "./ScriptAssist.js";
import type { ScriptStringEntry } from "./ScriptStringIndex.js";

/** 文字列の参照 1 つ（ホバーで本文を出す）。 */
export interface HoverStringRef {
  /** 役割（`ひらがなテキスト`・`漢字テキスト` など）。 */
  readonly role: string;
  /** ラベル。省略された引数なら null（ND の 0F は、漢字を省くとひらがなと同じ文字列を指す）。 */
  readonly label: string | null;
  /** 行の中の範囲（省略なら -1）。 */
  readonly start: number;
  readonly end: number;
  readonly entries: readonly ScriptStringEntry[];
}

/**
 * ホバーの中身（文言は画面側で組み立てる）。範囲 `start`〜`end` は行の中の桁（0 始まり）。
 * 種類は拡張のホバーと同じ順で決める: 命令 → 文字列の参照 → 文字列の引数の `.equ` → cmpvar / compare → ラベル → ほかの引数。
 */
export type AsmHover =
  | { readonly type: "command"; readonly start: number; readonly end: number; readonly command: ScriptCommand; readonly markdown: string }
  | { readonly type: "string"; readonly start: number; readonly end: number; readonly refs: readonly HoverStringRef[]; readonly active: number }
  | {
      readonly type: "stringEqu";
      readonly start: number;
      readonly end: number;
      readonly name: string;
      readonly role: string;
      readonly equ: ScriptEqu;
    }
  | {
      readonly type: "label";
      readonly start: number;
      readonly end: number;
      readonly name: string;
      readonly role: string;
      readonly labels: readonly ScriptLabel[];
    }
  | {
      readonly type: "value";
      readonly start: number;
      readonly end: number;
      readonly name: string;
      /** 役割（命令表の引数の推定）。cmpvar / compare なら「比較するイベント変数」など。 */
      readonly role: string;
      /** 必須の引数か。省略時の値（無ければ null）。 */
      readonly required: boolean;
      readonly defaultValue: string | null;
      /** 名前の `.equ`（無ければ null）。 */
      readonly equ: ScriptEqu | null;
      /** 数（`.equ` の値か、書いた数）。分からなければ null。 */
      readonly value: number | null;
      /** 変数の説明（0x800D は LASTRESULT など）。 */
      readonly variable: string | null;
      /** 名前の決まった定数の説明（YES / NO など）。 */
      readonly known: string | null;
      /** 同じ値の名前（数を書いたとき。最大 8）。 */
      readonly aliases: readonly string[];
    };

/** 1 行のホバー。`column` は行の中の桁（0 始まり）。出すものが無ければ null。 */
export function asmHoverAt(assist: ScriptAssist, a: AnalyzedLine, column: number): AsmHover | null {
  const op = a.line.op;
  if (!op) return null;
  if (insideComment(a, column)) return null;
  if (column >= op.start && column <= op.end) {
    if (!a.command) return null;
    return { type: "command", start: op.start, end: op.end, command: a.command, markdown: commandMarkdown(a.command) };
  }
  const arg = a.args.find((x) => column >= x.token.start && column <= x.token.end);
  if (!arg) return null;
  const { start, end } = arg.token;

  // 文字列の参照（ラベルが .string にある）
  if (assist.isStringLabel(arg.text) || arg.kind === "string") {
    const refs = stringRefs(assist, a, arg);
    const active = refs.findIndex((r) => r.start === start);
    if (refs.some((r) => r.entries.length > 0)) return { type: "string", start, end, refs, active: Math.max(0, active) };
    const equ = assist.index.findEqu(arg.text);
    if (equ) return { type: "stringEqu", start, end, name: arg.text, role: arg.role ?? "テキストポインタ", equ };
  }

  const name = a.opName?.toLowerCase();
  if (a.command && (name === "cmpvar" || name === "compare")) {
    const role = arg.index === 0 ? "比較するイベント変数" : "比較する値";
    return valueHover(assist, arg, role, arg.index === 0, false);
  }

  const labels = assist.index.findLabels(arg.text);
  if ((arg.kind === "label" || arg.kind === "movement") && labels.length > 0) {
    return { type: "label", start, end, name: arg.text, role: arg.role ?? "ラベル", labels: labels.slice(0, 3) };
  }
  if (!a.command && labels.length > 0) {
    return { type: "label", start, end, name: arg.text, role: "ラベル", labels: labels.slice(0, 3) };
  }
  if (!a.command && arg.kind === null) return null;
  return valueHover(assist, arg, arg.role ?? "値", arg.kind === "variable", true);
}

/** 命令のホバーの Markdown（命令表の書き方。CSV の hover が無ければマクロの名前・引数・直前のコメント）。 */
function commandMarkdown(command: ScriptCommand): string {
  const signature = command.args
    .map((a) => (a.defaultValue !== undefined ? `[${a.name}=${a.defaultValue}]` : a.required ? a.name : `[${a.name}]`))
    .join(" ");
  const source = command.macro ? `場所: \`xse_commands.s:${command.macro.line}\`` : null;
  const hover = command.hover.replace(/\\n/g, "\n");
  if (hover !== "") {
    let md = hover;
    if (command.macro) md += `\n\n引数: \`${command.name}${signature ? ` ${signature}` : ""}\`  \n${source}`;
    return md;
  }
  let md = `**${command.name}**${signature ? ` \`${signature}\`` : ""}`;
  if (command.description.length > 0) md += `\n\n${command.description.join("\n")}`;
  if (source) md += `\n\n${source}`;
  return md;
}

/**
 * 文字列の参照と、対になる参照（ND の `msgbox X type X_k` の X と X_k、customchoice の上と上の漢字）。
 * 対の引数が省かれていれば、ラベルを null にして入れる（ND の 0F は、漢字を省くとひらがなと同じ文字列）。
 */
function stringRefs(assist: ScriptAssist, a: AnalyzedLine, arg: AnalyzedArg): HoverStringRef[] {
  const ref = (x: AnalyzedArg, role: string): HoverStringRef => ({
    role,
    label: x.text,
    start: x.token.start,
    end: x.token.end,
    entries: assist.strings.find(x.text),
  });
  const role = arg.role ?? "テキスト";
  if (!a.command || !arg.argument) return [ref(arg, role)];
  const base = stringArgBase(arg.argument.name);
  const pairs = a.command.args.filter((p) => p.kind === "string" && p.pointer && stringArgBase(p.name) === base);
  if (pairs.length < 2) return [ref(arg, role)];
  return pairs.map((p) => {
    const given = a.args.find((x) => x.argument === p);
    if (given) return ref(given, p.role);
    return { role: p.role, label: null, start: -1, end: -1, entries: [] };
  });
}

function valueHover(assist: ScriptAssist, arg: AnalyzedArg, role: string, variable: boolean, withArg: boolean): AsmHover {
  const equ = assist.index.findEqu(arg.text) ?? null;
  const literal = parseAsmInteger(arg.text);
  const value = equ ? assist.constantValue(arg.text) : literal ?? (arg.token.kind === "symbol" ? assist.constantValue(arg.text) : null);
  const aliases = !equ && literal !== null ? assist.constantsWithValue(literal).filter((n) => n !== arg.text) : [];
  const sorted = [...aliases].sort((x, y) => aliasPriority(x) - aliasPriority(y) || x.localeCompare(y)).slice(0, 8);
  return {
    type: "value",
    start: arg.token.start,
    end: arg.token.end,
    name: arg.text,
    role,
    required: withArg ? (arg.argument?.required ?? false) : false,
    defaultValue: withArg ? (arg.argument?.defaultValue ?? null) : null,
    equ,
    value,
    variable: variable && value !== null ? describeScriptVariable(value) : null,
    known: describeKnownConstant(arg.text),
    aliases: sorted,
  };
}

function aliasPriority(name: string): number {
  if (/CUSTOM_CHOICE/.test(name)) return 0;
  if (/^(YES|NO|TRUE|FALSE|LASTRESULT)$/.test(name)) return 1;
  return 2;
}

function insideComment(a: AnalyzedLine, column: number): boolean {
  return a.line.tokens.some((t) => t.kind === "comment" && column >= t.start && column < t.end);
}

/** 行の中の区間の文字列（テスト用）。 */
export function hoverRangeText(a: AnalyzedLine, h: { start: number; end: number }): string {
  return asmTokenText(a.line, { kind: "symbol", start: h.start, end: h.end });
}
