/**
 * xse_commands.s（GNU as のマクロのファイル）を読む。
 * `.macro 名前 引数…` から `.endm` までを 1 つのマクロとし、引数（`:req`・`=既定値`・無印）、
 * 本文の文（データ・別のマクロの呼び出し・`.ifb` / `.ifnb` の分岐）、直前のコメント行を取り出す。
 * `.equ` / `.set` の定数も拾う。読めないマクロは本文を null にして理由を付け、ファイル全体では止まらない。
 */

/** マクロの引数。 */
export interface MacroParam {
  name: string;
  /** `:req` が付いている。 */
  required: boolean;
  /** `=既定値` の値。無ければ undefined。 */
  defaultValue?: string;
  /** `:vararg` が付いている（残りの引数をまとめて受ける）。 */
  vararg: boolean;
}

/** データの大きさ（バイト）。 */
export type MacroDataSize = 1 | 2 | 4;

/** マクロ本文の 1 文。 */
export type MacroStatement =
  /** `.byte` / `.hword` / `.2byte` / `.4byte` / `.word` など。values は `,` で分けた式の文字列。 */
  | { type: "data"; size: MacroDataSize; values: string[]; line: number }
  /** 別のマクロの呼び出し。args は空白か `,` で分けた引数の文字列。 */
  | { type: "call"; name: string; args: string[]; line: number }
  /** `.ifb X`（blank=true）/ `.ifnb X`（blank=false）。test は X の文字列。 */
  | { type: "ifBlank"; blank: boolean; test: string; then: MacroStatement[]; else: MacroStatement[]; line: number };

/** 読んだマクロ 1 つ。 */
export interface MacroDefinition {
  name: string;
  params: MacroParam[];
  /** `.macro` の行（1 始まり）。 */
  line: number;
  /** `.endm` の行（1 始まり）。閉じていなければ最後に読んだ行。 */
  endLine: number;
  /** 直前のコメント行（`@` を外した本文、上から順）。 */
  comment: string[];
  /** 本文の文。読めなければ null（error に理由）。 */
  body: MacroStatement[] | null;
  error?: string;
}

/** ファイルの中の読めなかった箇所。 */
export interface MacroFileProblem {
  /** マクロの名前。マクロの外なら null。 */
  name: string | null;
  line: number;
  reason: string;
}

/** xse_commands.s を読んだ結果。 */
export interface MacroFile {
  /** ファイルに出てくる順。同じ名前のマクロが 2 つ目以降に出たものは入れない（problems に出す）。 */
  macros: MacroDefinition[];
  /** `.equ` / `.set` の定数（名前 → 値の式の文字列）。 */
  constants: Map<string, string>;
  /** 読めなかったマクロ・箇所と理由。 */
  problems: MacroFileProblem[];
}

const DATA_SIZES: Record<string, MacroDataSize> = {
  ".byte": 1,
  ".hword": 2,
  ".2byte": 2,
  ".short": 2,
  ".4byte": 4,
  ".word": 4,
  ".long": 4,
  ".int": 4,
};

/** 1 行を、コード部分と行コメントに分ける。 */
interface SourceLine {
  code: string;
  /** 行全体が `@` か `//` のコメントなら、その本文。 */
  comment: string | null;
}

/** ブロックコメントと行コメントを外して、行ごとのコードとコメントにする。 */
function splitLines(text: string): SourceLine[] {
  const raw = text.replace(/^﻿/, "").split(/\r?\n/);
  const result: SourceLine[] = [];
  let inBlock = false;
  for (const line of raw) {
    let code = "";
    let i = 0;
    let touchedBlock = inBlock;
    let lineComment: string | null = null;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end === -1) {
          i = line.length;
          break;
        }
        inBlock = false;
        i = end + 2;
        continue;
      }
      const c = line[i]!;
      if (c === '"') {
        const close = line.indexOf('"', i + 1);
        const end = close === -1 ? line.length : close + 1;
        code += line.slice(i, end);
        i = end;
        continue;
      }
      if (line.startsWith("/*", i)) {
        inBlock = true;
        touchedBlock = true;
        i += 2;
        continue;
      }
      if (c === "@" || line.startsWith("//", i)) {
        lineComment = line.slice(i);
        break;
      }
      code += c;
      i++;
    }
    const comment =
      !touchedBlock && code.trim() === "" && lineComment !== null
        ? lineComment.replace(/^(@;?|\/\/)/, "").trim()
        : null;
    result.push({ code, comment });
  }
  return result;
}

/** `.macro` の行の引数の部分を読む。 */
function parseParams(text: string): MacroParam[] | string {
  const params: MacroParam[] = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*)\s*(:\s*(req|vararg))?\s*(=\s*([^\s,]*))?\s*,?/y;
  let rest = text.trim();
  while (rest.length > 0) {
    re.lastIndex = 0;
    const m = re.exec(rest);
    if (!m || m[0].length === 0) return `引数の書き方が読めません: ${rest}`;
    params.push({
      name: m[1]!,
      required: m[3] === "req",
      vararg: m[3] === "vararg",
      ...(m[4] !== undefined ? { defaultValue: m[5] ?? "" } : {}),
    });
    rest = rest.slice(m[0].length).trim();
  }
  return params;
}

/** マクロ呼び出しの引数を分ける（GNU as と同じく `,` か空白で区切る）。 */
export function splitMacroCallArgs(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let pendingSpace = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0 && c === ",") {
      args.push(current.trim());
      current = "";
      pendingSpace = false;
      continue;
    }
    if (depth === 0 && (c === " " || c === "\t")) {
      pendingSpace = current.trim() !== "";
      continue;
    }
    if (pendingSpace) {
      // 空白の前後が演算子でなければ、空白は区切り。
      const prev = current.trimEnd().slice(-1);
      if (/[+\-*/|&^<>~(]/.test(c) || /[+\-*/|&^<>~(]/.test(prev)) {
        current += " ";
      } else {
        args.push(current.trim());
        current = "";
      }
      pendingSpace = false;
    }
    current += c;
  }
  args.push(current.trim());
  return args;
}

/** 本文の行を文に直す。読めない文があれば理由の文字列を返す。 */
function parseBody(lines: { code: string; line: number }[]): MacroStatement[] | string {
  type Frame = { list: MacroStatement[]; stmt: Extract<MacroStatement, { type: "ifBlank" }> | null; inElse: boolean };
  const root: Frame = { list: [], stmt: null, inElse: false };
  const stack: Frame[] = [root];
  for (const { code, line } of lines) {
    for (const part of code.split(";")) {
      const text = part.trim();
      if (text === "") continue;
      const top = stack[stack.length - 1]!;
      const m = /^(\.[A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_.]*)\s*(.*)$/.exec(text);
      if (!m) return `${line} 行目が読めません: ${text}`;
      const word = m[1]!;
      const rest = m[2]!;
      const lower = word.toLowerCase();
      const size = DATA_SIZES[lower];
      if (size !== undefined) {
        const values = rest.split(",").map((v) => v.trim());
        if (values.some((v) => v === "")) return `${line} 行目の ${word} に空の値があります`;
        top.list.push({ type: "data", size, values, line });
        continue;
      }
      if (lower === ".ifb" || lower === ".ifnb") {
        const stmt: Extract<MacroStatement, { type: "ifBlank" }> = {
          type: "ifBlank",
          blank: lower === ".ifb",
          test: rest.trim(),
          then: [],
          else: [],
          line,
        };
        top.list.push(stmt);
        stack.push({ list: stmt.then, stmt, inElse: false });
        continue;
      }
      if (lower === ".else") {
        if (!top.stmt || top.inElse) return `${line} 行目の .else に対応する .ifb / .ifnb がありません`;
        top.inElse = true;
        top.list = top.stmt.else;
        continue;
      }
      if (lower === ".endif") {
        if (!top.stmt) return `${line} 行目の .endif に対応する .ifb / .ifnb がありません`;
        stack.pop();
        continue;
      }
      if (word.startsWith(".")) return `${line} 行目の ${word} には対応していません`;
      if (rest.startsWith(":") || rest.startsWith("=")) return `${line} 行目の ${text} には対応していません`;
      top.list.push({ type: "call", name: word, args: splitMacroCallArgs(rest), line });
    }
  }
  if (stack.length > 1) return `${stack[stack.length - 1]!.stmt!.line} 行目の .ifb / .ifnb が .endif で閉じていません`;
  return root.list;
}

/** xse_commands.s の文字列を読む。例外は投げない。 */
export function parseMacroFile(text: string): MacroFile {
  const lines = splitLines(text);
  const macros: MacroDefinition[] = [];
  const seen = new Set<string>();
  const constants = new Map<string, string>();
  const problems: MacroFileProblem[] = [];

  let i = 0;
  while (i < lines.length) {
    const code = lines[i]!.code.trim();
    const equ = /^\.(?:equ|set)\s+([A-Za-z_.$][A-Za-z0-9_.$]*)\s*,\s*(.+)$/i.exec(code);
    if (equ) {
      constants.set(equ[1]!, equ[2]!.trim());
      i++;
      continue;
    }
    const head = /^\.macro\s+([A-Za-z_.$][A-Za-z0-9_.$]*)\s*,?\s*(.*)$/i.exec(code);
    if (!head) {
      if (/^\.endm\b/i.test(code)) problems.push({ name: null, line: i + 1, reason: ".macro の無い .endm があります" });
      i++;
      continue;
    }
    const name = head[1]!;
    const start = i;
    const comment: string[] = [];
    for (let j = start - 1; j >= 0; j--) {
      const l = lines[j]!;
      if (l.code.trim() === "" && l.comment === null) {
        if (comment.length > 0) break;
        continue;
      }
      if (l.comment === null) break;
      if (l.comment !== "" && !/^[@=-]+$/.test(l.comment)) comment.unshift(l.comment);
    }

    // 対応する .endm を探す（中の .macro は数える）。
    let depth = 1;
    let end = -1;
    let nested = false;
    for (let j = start + 1; j < lines.length; j++) {
      const c = lines[j]!.code.trim();
      if (/^\.macro\b/i.test(c)) {
        depth++;
        nested = true;
      } else if (/^\.endm\b/i.test(c)) {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    const params = parseParams(head[2]!);
    const def: MacroDefinition = {
      name,
      params: typeof params === "string" ? [] : params,
      line: start + 1,
      endLine: (end === -1 ? lines.length - 1 : end) + 1,
      comment,
      body: null,
    };
    if (end === -1) {
      def.error = ".endm で閉じていません";
    } else if (typeof params === "string") {
      def.error = params;
    } else if (nested) {
      def.error = "マクロの中で .macro を使っています";
    } else {
      const body = parseBody(lines.slice(start + 1, end).map((l, k) => ({ code: l.code, line: start + 2 + k })));
      if (typeof body === "string") def.error = body;
      else def.body = body;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      problems.push({ name, line: def.line, reason: "同じ名前のマクロが前にもあります（後のものは使いません）" });
    } else {
      seen.add(key);
      macros.push(def);
      if (def.error) problems.push({ name, line: def.line, reason: def.error });
    }
    i = end === -1 ? lines.length : end + 1;
  }
  return { macros, constants, problems };
}
