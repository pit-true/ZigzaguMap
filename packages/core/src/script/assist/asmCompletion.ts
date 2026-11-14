import { asmTokenText } from "../asm/AsmLine.js";
import type { CommandArgumentKind } from "../commands/argumentKinds.js";
import { ASM_DIRECTIVES, isAsmNameChar, type AnalyzedLine, type ScriptAssist } from "./ScriptAssist.js";

/** 補完の候補の種類。 */
export type AsmCompletionType = "command" | "directive" | "label" | "string" | "movement" | "variable" | "flag" | "constant" | "msgType";

/** 補完の候補 1 つ。 */
export interface AsmCompletionItem {
  readonly label: string;
  readonly type: AsmCompletionType;
  /** 候補の横に出す短い説明（命令の引数の並び、ラベルの場所、`.equ` の値など）。 */
  readonly detail?: string;
  /** 選んだときに横に出す説明（Markdown。命令の説明、文字列の本文など）。 */
  readonly info?: string;
  /** 並びの優先度（大きいほど上）。 */
  readonly boost?: number;
}

/** 補完の結果。`from`〜`to` は置き換える範囲（行の中の桁）。 */
export interface AsmCompletion {
  readonly from: number;
  readonly to: number;
  /** 命令名の位置か、引数の位置か。 */
  readonly context: "op" | "argument";
  /** 引数の位置なら、その番号（0 から）と種類。 */
  readonly argIndex: number | null;
  readonly kind: CommandArgumentKind | "msgType" | null;
  readonly items: readonly AsmCompletionItem[];
}

/** 文字列の本文の短い表示（補完の横）。 */
function preview(text: string, max = 24): string {
  const t = text.replace(/\\[nlp]/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * 1 行の補完。`column` はカーソルの桁（0 始まり）。コメントの中・文字列の中なら null。
 * - 命令名の位置（行頭かラベルの後ろ）: 命令表の命令とディレクティブ
 * - 引数の位置: 引数の種類に合わせて、文字列のラベル・ラベル・移動の名前・変数・フラグ・定数。msgbox の 2 つ目は `MSG_*`
 */
export function asmCompletionAt(assist: ScriptAssist, a: AnalyzedLine, column: number): AsmCompletion | null {
  const text = a.line.text;
  for (const t of a.line.tokens) {
    if (t.kind === "comment" && column > t.start) return null;
    if (t.kind === "string" && column > t.start && column < t.end) return null;
  }
  let from = column;
  while (from > 0 && isAsmNameChar(text.charCodeAt(from - 1))) from--;
  let to = column;
  while (to < text.length && isAsmNameChar(text.charCodeAt(to))) to++;

  const op = a.line.op;
  const labelEnd = a.line.labels.length > 0 ? a.line.labels[a.line.labels.length - 1]!.end : -1;
  if (!op || (column >= op.start && column <= op.end)) {
    if (!op && labelEnd >= 0 && column <= labelEnd) return null;
    return { from, to, context: "op", argIndex: null, kind: null, items: opItems(assist) };
  }
  if (column < op.start) return null;

  // 引数の番号: カーソルを含む引数、無ければカーソルより前にある引数の数
  let argIndex = a.line.args.findIndex((t) => from >= t.start && from <= t.end);
  if (argIndex < 0) argIndex = a.line.args.filter((t) => t.end <= from).length;
  const name = a.opName ?? "";
  if (a.line.op?.kind === "directive") {
    if (![".byte", ".2byte", ".4byte", ".hword", ".word", ".long"].includes(name)) return null;
    const kind: CommandArgumentKind = name === ".byte" ? "movement" : "label";
    return { from, to, context: "argument", argIndex, kind, items: argumentItems(assist, kind) };
  }
  if (!a.command) return null;
  const last = a.command.args[a.command.args.length - 1];
  const argument = a.command.args[argIndex] ?? (last?.vararg ? last : null);
  if (!argument) return null;
  if (/^(msgbox|'message)$/i.test(name) && argument.name.toLowerCase() === "type") {
    const items = assist.msgboxTypes().map((t, i) => ({ label: t.name, type: "msgType" as const, detail: `${t.name} = ${t.value}`, info: t.description, boost: 50 - i }));
    return { from, to, context: "argument", argIndex, kind: "msgType", items };
  }
  return { from, to, context: "argument", argIndex, kind: argument.kind, items: argumentItems(assist, argument.kind) };
}

function opItems(assist: ScriptAssist): AsmCompletionItem[] {
  const out: AsmCompletionItem[] = [];
  for (const c of assist.commands?.commands ?? []) {
    const signature = c.args
      .map((x) => (x.defaultValue !== undefined ? `[${x.name}=${x.defaultValue}]` : x.required ? x.name : `[${x.name}]`))
      .join(" ");
    const info = c.hover !== "" ? c.hover.replace(/\\n/g, "\n") : c.description.join("\n");
    out.push({ label: c.name, type: "command", detail: signature || c.detail || undefined, ...(info ? { info } : {}) } as AsmCompletionItem);
  }
  for (const d of ASM_DIRECTIVES) out.push({ label: d, type: "directive", boost: -10 });
  return out;
}

/** 引数の種類ごとの候補。 */
export function argumentItems(assist: ScriptAssist, kind: CommandArgumentKind): AsmCompletionItem[] {
  const out: AsmCompletionItem[] = [];
  const labels = (boost = 0) => {
    for (const l of assist.index.allLabels()) {
      out.push({ label: l.name, type: "label", detail: `${l.path}:${l.line}`, ...(l.preview.length ? { info: "```asm\n" + l.preview.join("\n") + "\n```" } : {}), boost } as AsmCompletionItem);
    }
  };
  const strings = (boost = 0) => {
    for (const name of assist.strings.labels()) {
      const e = assist.strings.find(name)[0]!;
      out.push({ label: name, type: "string", detail: preview(e.text), info: e.text, boost });
    }
  };
  const constants = (filter: (name: string, value: number | null) => boolean, type: AsmCompletionType, boost = 0) => {
    const seen = new Set<string>();
    for (const { equ, value } of assist.allConstants()) {
      if (seen.has(equ.name) || !filter(equ.name, value)) continue;
      seen.add(equ.name);
      out.push({ label: equ.name, type, detail: equ.value, ...(equ.description ? { info: equ.description } : {}), boost });
    }
  };
  switch (kind) {
    case "string":
      strings(10);
      break;
    case "label":
      labels(10);
      break;
    case "movement": {
      for (const name of assist.index.movementNames()) out.push({ label: name, type: "movement", detail: assist.index.findEqu(name)?.value, boost: 20 });
      labels(0);
      break;
    }
    case "variable":
      constants((n, v) => /^VAR_|^LASTRESULT$|^LASTTALKED$|^PLAYERFACING$/i.test(n) || (v !== null && ((v >= 0x4000 && v <= 0x40ff) || (v >= 0x8000 && v <= 0x8014))), "variable", 10);
      break;
    case "flag":
      constants((n) => /FLAG/i.test(n), "flag", 10);
      break;
    default:
      constants(() => true, "constant");
  }
  return out;
}

/** 候補の文字列（テスト用）。 */
export function completionLabels(c: AsmCompletion | null): string[] {
  return c ? c.items.map((i) => i.label) : [];
}

/** 置き換える範囲の文字列（テスト用）。 */
export function completionWord(a: AnalyzedLine, c: AsmCompletion): string {
  return asmTokenText(a.line, { kind: "symbol", start: c.from, end: c.to });
}
