import { asmOpName, asmTokenText, parseAsmLine, type AsmLine } from "../asm/AsmLine.js";
import { evaluateMacroExpression } from "../commands/macroExpression.js";
import type { DisasmMovement } from "../disasm/DisasmTypes.js";
import { findLabelOccurrences } from "../edit/LabelRename.js";
import { MOVEMENT_END } from "./MovementActionTable.js";

/**
 * `.s` の移動データ（`m_Walk: .byte walk_up, walk_up, end_m`）の読み取りと、書き方を保った書き戻し（#449）。
 * 再生（#451）が読み、タイムラインの編集（#458）が書く。文字列の処理だけで、ファイルには触らない。
 */

/** 移動データの 1 項目。 */
export interface MovementStep {
  /** 値（0x00〜0xFF）。 */
  readonly value: number;
  /** 書いてあった文字（`walk_up`、`0x60` など）。 */
  readonly text: string;
  /** 行（0 始まり）。 */
  readonly line: number;
  /** 桁（0 始まり、end は含まない）。 */
  readonly start: number;
  readonly end: number;
}

/** 書き戻せない理由。 */
export type MovementBlockProblemKind =
  /** ラベルが見つからない。 */
  | "notFound"
  /** 同じラベルが 2 か所以上にある。 */
  | "duplicateLabel"
  /** `end_m`（0xFE）の前にファイルが終わった。 */
  | "noEnd"
  /** `.if` などの中にある、または途中に `.if` などがある。 */
  | "conditional"
  /** 途中にマクロ（命令）がある。 */
  | "macro"
  /** `.byte` 以外のディレクティブ（`.hword` など）がある。 */
  | "notByte"
  /** 値の分からない名前・式がある。 */
  | "unknownName"
  /** 途中に別のラベルがある。 */
  | "labelInside"
  /** ROM の移動データ（アドレスのまま）。 */
  | "rom";

/** 書き戻せない理由と、その行。 */
export interface MovementBlockProblem {
  readonly kind: MovementBlockProblemKind;
  /** 行（0 始まり）。分からなければ null。 */
  readonly line: number | null;
  /** 名前（`unknownName` の名前、`macro` の命令名など）。無ければ null。 */
  readonly detail: string | null;
}

/** 読んだ移動データ。 */
export interface MovementBlock {
  readonly label: string;
  /** ラベルの行（0 始まり）。ROM のものは -1。 */
  readonly labelLine: number;
  /** 命令の並び（`end_m` を含まない）。 */
  readonly steps: readonly MovementStep[];
  /** `end_m` の項目。読めずに止まったときは null。 */
  readonly endStep: MovementStep | null;
  /** 書き戻せない理由。書き戻せるなら null。 */
  readonly problem: MovementBlockProblem | null;
}

/** 名前を数に直す関数（`.equ` など）。知らなければ null。 */
export type MovementNameResolver = (name: string) => number | null;

const CONDITIONAL_OPEN = /^\.if(n?def|n?b|c|eqs|nes|ne|eq|ge|gt|le|lt)?$/;

/**
 * ラベルの次から `.byte` の行を読み、0xFE（`end_m`）までの命令の並びを返す。ラベルと同じ行の `.byte`、1 行に並べた形、
 * 1 行 1 命令、行の後ろのコメント、CRLF を扱う。ラベルが無ければ null。
 * 読めない所（`end_m` が無い、`.if` やマクロが混じる、値の分からない名前、ラベルが 2 か所）は problem に理由を入れ、
 * そこまでの並びを返す。
 */
export function readMovementBlock(text: string, label: string, resolve: MovementNameResolver): MovementBlock | null {
  const rows = text.split(/\r?\n/);
  const lines: AsmLine[] = [];
  let inBlock = false;
  for (const row of rows) {
    const l = parseAsmLine(row, inBlock);
    lines.push(l);
    inBlock = l.endsInBlockComment;
  }
  let labelLine = -1;
  let labelEnd = 0;
  let count = 0;
  let conditionalDepth = 0;
  let labelDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const t of line.labels) {
      if (asmTokenText(line, t) !== label) continue;
      count++;
      if (labelLine < 0) {
        labelLine = i;
        labelEnd = t.end;
        labelDepth = conditionalDepth;
      }
    }
    const op = asmOpName(line);
    if (op !== null && CONDITIONAL_OPEN.test(op)) conditionalDepth++;
    else if (op === ".endif" && conditionalDepth > 0) conditionalDepth--;
  }
  if (labelLine < 0) return null;

  const steps: MovementStep[] = [];
  let problem: MovementBlockProblem | null = null;
  if (count > 1) problem = { kind: "duplicateLabel", line: labelLine, detail: null };
  else if (labelDepth > 0) problem = { kind: "conditional", line: labelLine, detail: null };
  const fail = (kind: MovementBlockProblemKind, line: number, detail: string | null = null): MovementBlock => ({
    label,
    labelLine,
    steps,
    endStep: null,
    problem: problem ?? { kind, line, detail },
  });

  for (let i = labelLine; i < lines.length; i++) {
    const line = lines[i]!;
    // 自分のラベルより後ろ（同じ行）か、次の行から。
    const otherLabel = line.labels.find((t) => i !== labelLine || t.start > labelEnd);
    if (otherLabel) problem ??= { kind: "labelInside", line: i, detail: asmTokenText(line, otherLabel) };
    if (!line.op) continue;
    const op = asmOpName(line)!;
    if (line.op.kind === "mnemonic") return fail("macro", i, op);
    if (CONDITIONAL_OPEN.test(op) || op === ".else" || op === ".elseif" || op === ".endif") return fail("conditional", i, op);
    if (op !== ".byte") return fail("notByte", i, op);
    for (const arg of line.args) {
      const raw = asmTokenText(line, arg);
      const value = evaluateMacroExpression(raw, resolve);
      if (value === null || value < 0 || value > 0xff) return fail("unknownName", i, raw);
      const step: MovementStep = { value, text: raw, line: i, start: arg.start, end: arg.end };
      if (value === MOVEMENT_END) return { label, labelLine, steps, endStep: step, problem };
      steps.push(step);
    }
  }
  return fail("noEnd", lines.length - 1);
}

/** ROM の移動データ（`disassembleScripts` の `movements` の 1 つ）を同じ形にする。書き戻せない印（`rom`）を付ける。 */
export function movementBlockFromRom(m: DisasmMovement): MovementBlock {
  const steps: MovementStep[] = [];
  let endStep: MovementStep | null = null;
  m.steps.forEach((value, i) => {
    const text = m.names[i] ?? `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
    const step: MovementStep = { value, text, line: -1, start: i, end: i + 1 };
    if (value === MOVEMENT_END) endStep ??= step;
    else if (endStep === null) steps.push(step);
  });
  return { label: m.label, labelLine: -1, steps, endStep, problem: { kind: "rom", line: null, detail: null } };
}

/** 値の書き方（名前があれば名前、無ければ 16 進）。 */
export type MovementValueFormatter = (value: number) => string | null;

/**
 * 移動データの範囲の行だけを新しい並びに置き換えた本文を返す。values は `end_m` を含まない新しい並び（`end_m` は自分で足す）。
 *
 * - 変わらない項目は書いてあった文字のまま（名前も 16 進も）、行の後ろのコメントも残す。
 * - 1 行に並べた形はそのまま 1 行に、1 行 1 命令の形はそのまま 1 行 1 命令で書く。足した行は前の行の字下げと `.byte` に合わせる。
 * - 新しい値は、名前があれば名前、無ければ `0x` の 16 進（大文字）で書く。
 * - 範囲の外は 1 文字も変えない（改行も）。
 * 書き戻せない移動データ（problem があるもの）は例外。
 */
export function writeMovementBlock(text: string, block: MovementBlock, values: readonly number[], nameOf: MovementValueFormatter): string {
  if (block.problem || !block.endStep) throw new Error(`書き戻せない移動データです: ${block.label}（${block.problem?.kind ?? "noEnd"}）`);
  const old = [...block.steps, block.endStep];
  const next = [...values, MOVEMENT_END];
  const plan = alignSteps(
    old.map((s) => s.value),
    next,
  );

  // 行ごとに、新しい項目の文字を並べる。
  const firstLine = Math.min(block.labelLine, old[0]!.line);
  const lastLine = block.endStep.line;
  const rows = splitKeepEnds(text);
  const perLine = new Map<number, string[]>();
  for (let l = old[0]!.line; l <= lastLine; l++) perLine.set(l, []);
  /** 1 行 1 命令の形か（どの行も項目が 1 つ）。 */
  const counts = new Map<number, number>();
  for (const s of old) counts.set(s.line, (counts.get(s.line) ?? 0) + 1);
  const oneEach = [...counts.values()].every((n) => n === 1) && counts.size > 1;
  /** 足した項目に付ける、自分だけの新しい行（1 行 1 命令の形のとき）。行の後ろに足す。 */
  const extraAfter = new Map<number, string[]>();
  /** 先頭より前に足す行（1 行 1 命令の形で、最初の項目より前に足したとき）。 */
  const extraBefore: string[] = [];
  /** 新しい値の書き方。同じ値が元の並びにあれば、その書き方（名前か 16 進）に合わせる。 */
  const textOf = (value: number): string => old.find((s) => s.value === value)?.text ?? formatValue(value, nameOf);
  let lastLineOf = old[0]!.line;
  let emitted = false;
  for (const p of plan) {
    if (p.old !== null) {
      const s = old[p.old]!;
      lastLineOf = s.line;
      emitted = true;
      perLine.get(s.line)!.push(p.keep ? s.text : textOf(next[p.next!]!));
      continue;
    }
    const v = textOf(next[p.next!]!);
    if (oneEach && !emitted) {
      extraBefore.push(v);
    } else if (oneEach) {
      const list = extraAfter.get(lastLineOf) ?? [];
      list.push(v);
      extraAfter.set(lastLineOf, list);
    } else {
      perLine.get(lastLineOf)!.push(v);
    }
  }

  const out: string[] = [];
  for (let l = firstLine; l <= lastLine; l++) {
    const row = rows[l]!;
    const items = perLine.get(l);
    const lineSteps = old.filter((s) => s.line === l);
    if (l === old[0]!.line && extraBefore.length > 0) {
      const prefix = linePrefix(row.text, lineSteps[0]!);
      for (const v of extraBefore) out.push(prefix + v + (row.eol || eolOf(text)));
    }
    if (items === undefined || lineSteps.length === 0) {
      out.push(row.text + row.eol);
    } else {
      const rewritten = rewriteLine(row.text, lineSteps, items, l === block.labelLine);
      if (rewritten !== null) out.push(rewritten + row.eol);
    }
    const extra = extraAfter.get(l);
    if (extra) {
      const prefix = linePrefix(row.text, lineSteps[0]!);
      for (const v of extra) out.push(prefix + v + (row.eol || eolOf(text)));
    }
  }
  return rows.slice(0, firstLine).map((r) => r.text + r.eol).join("") + out.join("") + rows.slice(lastLine + 1).map((r) => r.text + r.eol).join("");
}

/** 行の `.byte` の引数の部分を items に置き換える。項目が無くなり、ラベルも無い行は null（行ごと消す）。 */
function rewriteLine(row: string, steps: readonly MovementStep[], items: readonly string[], hasLabel: boolean): string | null {
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  if (items.length > 0) return row.slice(0, first.start) + items.join(separatorOf(row, steps)) + row.slice(last.end);
  if (!hasLabel) return null;
  // ラベルの行の項目が全部消えた: `.byte` と引数を外し、ラベル（とコメント）だけ残す。
  const line = parseAsmLine(row);
  const opStart = line.op?.start ?? first.start;
  const head = row.slice(0, opStart).replace(/\s+$/, "");
  const tail = row.slice(last.end);
  return head + tail;
}

/** 項目の区切り（元の 1 つ目と 2 つ目の間の文字。1 つしか無ければ `, `）。 */
function separatorOf(row: string, steps: readonly MovementStep[]): string {
  if (steps.length < 2) return ", ";
  return row.slice(steps[0]!.end, steps[1]!.start);
}

/** 1 行 1 命令の形で足す行の、値の前の部分（字下げと `.byte `）。ラベルの行なら、ラベルの分を空白にする。 */
function linePrefix(row: string, step: MovementStep): string {
  const line = parseAsmLine(row);
  const before = row.slice(0, step.start);
  if (line.labels.length === 0) return before;
  const opStart = line.op?.start ?? step.start;
  const indent = /^\s*/.exec(row)?.[0] ?? "";
  return indent + "\t" + row.slice(opStart, step.start).replace(/^\s+/, "");
}

function formatValue(value: number, nameOf: MovementValueFormatter): string {
  return nameOf(value) ?? `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function eolOf(text: string): string {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

/** 行と、その後ろの改行（最後の行は空）。 */
function splitKeepEnds(text: string): { text: string; eol: string }[] {
  const out: { text: string; eol: string }[] = [];
  const re = /\r?\n/g;
  let from = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ text: text.slice(from, m.index), eol: m[0] });
    from = m.index + m[0].length;
  }
  out.push({ text: text.slice(from), eol: "" });
  return out;
}

/** 並びの対応の 1 項目。old・next は番号、keep は同じ値（old の文字をそのまま使う）。 */
interface AlignItem {
  readonly old: number | null;
  readonly next: number | null;
  readonly keep: boolean;
}

/**
 * 古い並びと新しい並びを、同じ値をできるだけ残すように対応させる（最長共通部分列）。
 * 消した項目のすぐ後に足した項目は「差し替え」として古い項目の場所（行とコメント）に入れる。
 * 返す並びは新しい並びの順で、消えた古い項目は入らない。
 */
function alignSteps(old: readonly number[], next: readonly number[]): AlignItem[] {
  const n = old.length;
  const m = next.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = old[i] === next[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  // 操作の列（keep / del / add）。
  const ops: { type: "keep" | "del" | "add"; i: number; j: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && old[i] === next[j]) ops.push({ type: "keep", i: i++, j: j++ });
    else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) ops.push({ type: "add", i, j: j++ });
    else ops.push({ type: "del", i: i++, j });
  }
  // 消した項目と足した項目が並ぶところは、差し替えにまとめる。
  const out: AlignItem[] = [];
  for (let k = 0; k < ops.length; ) {
    const op = ops[k]!;
    if (op.type === "keep") {
      out.push({ old: op.i, next: op.j, keep: true });
      k++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (k < ops.length && ops[k]!.type !== "keep") {
      const o = ops[k]!;
      if (o.type === "del") dels.push(o.i);
      else adds.push(o.j);
      k++;
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) out.push({ old: dels[p]!, next: adds[p]!, keep: false });
    for (let p = pairs; p < adds.length; p++) out.push({ old: null, next: adds[p]!, keep: false });
  }
  return out;
}

/** 移動データのラベルを使っている所（定義を除く）。A-8 の「何か所で使っているか」の確かめに使う。 */
export interface MovementReference {
  readonly path: string;
  /** 行（0 始まり）。 */
  readonly line: number;
}

/** ラベルを使っている所を数える（`findLabelOccurrences` の定義でないもの）。files は `.s` のパスと本文。 */
/** 行頭のシンボルの宣言（`.global` など）。 */
const SYMBOL_DIRECTIVE = /^\s*\.(?:global|globl|weak|hidden|type|size)\s/i;

export function countMovementReferences(files: Iterable<{ readonly path: string; readonly text: string }>, label: string): MovementReference[] {
  const out: MovementReference[] = [];
  for (const f of files) {
    for (const o of findLabelOccurrences(f.text, label)) {
      if (o.definition) continue;
      // `.global m_W` などのシンボルの宣言は、使っている所ではない（#493 の往復テストで 2 か所と数えていた）
      const start = f.text.lastIndexOf("\n", o.from - 1) + 1;
      if (SYMBOL_DIRECTIVE.test(f.text.slice(start, o.from))) continue;
      let line = 0;
      for (let k = f.text.indexOf("\n"); k >= 0 && k < o.from; k = f.text.indexOf("\n", k + 1)) line++;
      out.push({ path: f.path, line });
    }
  }
  return out;
}
