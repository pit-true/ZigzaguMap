import { asmEquDefinition, asmTokenText, parseAsmLine, type AsmLine } from "../asm/AsmLine.js";
import { evaluateMacroExpression } from "../commands/macroExpression.js";
import { localMacroNames, type ScriptAssist } from "./ScriptAssist.js";

/** 波線の種類。文言は画面側で `code` と `params` から作る。 */
export type ScriptDiagnosticCode =
  /** 命令表にも ARM / Thumb の命令にも、同じファイルの `.macro` にも無い命令。 */
  | "unknownCommand"
  /** どこにも定義の無いラベル（命令の引数のうち、ラベル・移動データ・文字列を指すもの）。 */
  | "undefinedLabel"
  /** 必須の引数が足りない（マクロの `:req`）。 */
  | "missingArgs"
  /** 引数が多すぎる。 */
  | "tooManyArgs"
  /** 同じ `.string` に同じラベルの `#org` が 2 つ以上ある。 */
  | "duplicateString"
  /** 別の `.string` に同じラベルがある。 */
  | "duplicateStringOther"
  /** 簡易の幅検査（字数）で、1 行の字数か 1 ページの行数が上限を超えた。 */
  | "textWidth"
  /** 外から足した波線（ビルド・幅検査のコマンドの出力）。文言は `params.message`。 */
  | "external";

/** 波線 1 つ。`from`〜`to` は本文（改行は `\n`）の中の位置。 */
export interface ScriptDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: "error" | "warning" | "info";
  readonly code: ScriptDiagnosticCode;
  readonly params: Readonly<Record<string, string | number>>;
}

/** ラベルの引数を調べない命令（C の関数や仮想オフセットを指す）。 */
const NO_LABEL_CHECK = /^(callasm\d*|callnative|callfunc|virtual\w*)$/i;

/**
 * `.s` の本文を調べて波線を返す。調べるのは、知らない命令、引数の数（マクロの `:req` と引数の数）、
 * どこにも定義の無いラベル（索引・文字列の索引・`.equ`・同じ本文の定義に無いもの）。
 * 本文の中のラベルと `.equ` も定義として数えるので、索引がまだ古くても誤った波線は出ない。
 */
export function lintAsmText(assist: ScriptAssist, text: string): ScriptDiagnostic[] {
  const rows = text.split("\n");
  const lines: AsmLine[] = new Array(rows.length);
  let inBlock = false;
  for (let i = 0; i < rows.length; i++) {
    const line = parseAsmLine(rows[i]!, inBlock);
    lines[i] = line;
    inBlock = line.endsInBlockComment;
  }
  const local = new Set<string>();
  for (const line of lines) {
    for (const l of line.labels) local.add(asmTokenText(line, l));
    const equ = asmEquDefinition(line);
    if (equ) local.add(equ.name);
  }
  const macros = localMacroNames(lines);
  // マクロの本文で `名前\引数:` と作るラベル（`EventScript_ShowSelectItems\num:`）は、頭の名前で始まれば定義済みとみなす
  const generated = [...text.matchAll(/^[ \t]*([A-Za-z_.$][A-Za-z0-9_.$]*)\\[A-Za-z_]\w*:/gm)].map((m) => m[1]!);
  const out: ScriptDiagnostic[] = [];
  let offset = 0;
  let inMacro = false;
  // `.if 0` などで外した範囲（入れ子の各段が有効か）
  const conditions: boolean[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const base = offset;
    offset += rows[i]!.length + 1;
    if (!line.op) continue;
    const a = assist.analyzeParsed(line, macros);
    if (a.opName === ".macro") inMacro = true;
    if (a.opName === ".endm") inMacro = false;
    if (a.opName !== null && updateConditions(assist, a.opName, line, conditions)) continue;
    if (conditions.includes(false)) continue;
    // マクロの本文（`\引数` を使う）と、ディレクティブの行は調べない
    if (inMacro || a.opKind === "directive" || a.opKind === "instruction" || a.opKind === "localMacro") continue;
    if (a.opKind === "unknown") {
      out.push({ from: base + line.op.start, to: base + line.op.end, severity: "warning", code: "unknownCommand", params: { name: a.opName ?? "" } });
      continue;
    }
    const command = a.command!;
    const params = command.args;
    const vararg = params.some((p) => p.vararg);
    const missing = params.filter((p) => p.required && p.index >= a.args.length);
    if (missing.length > 0) {
      out.push({
        from: base + line.op.start,
        to: base + (line.args[line.args.length - 1]?.end ?? line.op.end),
        severity: "error",
        code: "missingArgs",
        params: { name: command.name, missing: missing.map((p) => p.name).join(", "), required: params.filter((p) => p.required).length, given: a.args.length },
      });
    }
    if (!vararg && a.args.length > params.length) {
      const extra = a.args[params.length]!;
      out.push({
        from: base + extra.token.start,
        to: base + a.args[a.args.length - 1]!.token.end,
        severity: "error",
        code: "tooManyArgs",
        params: { name: command.name, max: params.length, given: a.args.length },
      });
    }
    if (NO_LABEL_CHECK.test(command.name)) continue;
    for (const arg of a.args) {
      if (arg.token.kind !== "symbol" || !arg.argument) continue;
      const declared = arg.declaredKind;
      const pointerString = declared === "string" && arg.argument.pointer;
      if (declared !== "label" && declared !== "movement" && !pointerString) continue;
      const name = arg.text;
      if (local.has(name) || assist.hasLabel(name) || assist.isStringLabel(name) || assist.hasConstant(name) || assist.isLinkerSymbol(name)) continue;
      if (generated.some((prefix) => name.startsWith(prefix))) continue;
      out.push({ from: base + arg.token.start, to: base + arg.token.end, severity: "warning", code: "undefinedLabel", params: { name, role: arg.role ?? "" } });
    }
  }
  return out;
}

/**
 * `.if` / `.ifdef` / `.ifndef` / `.else` / `.endif` の行なら、条件の段を更新して true。
 * `.if` の式は `.equ` の定数で計算し、0 なら外した範囲にする（計算できなければ有効とみなす）。`.ifdef` 系はいつも有効とみなす。
 */
function updateConditions(assist: ScriptAssist, op: string, line: AsmLine, stack: boolean[]): boolean {
  if (op === ".if") {
    const expr = line.args.map((t) => asmTokenText(line, t)).join(" ");
    const value = evaluateMacroExpression(expr, (n) => assist.constantValue(n));
    stack.push(value !== 0);
    return true;
  }
  if (op.startsWith(".if")) {
    stack.push(true);
    return true;
  }
  if (op === ".else" || op === ".elseif") {
    if (stack.length > 0) stack[stack.length - 1] = op === ".else" ? !stack[stack.length - 1] : true;
    return true;
  }
  if (op === ".endif") {
    stack.pop();
    return true;
  }
  return false;
}
