/**
 * `.s`（GNU as の ARM 向けの書き方）の 1 行の解析。エディタの色付け（見えている行ごとに呼ぶ）と
 * ラベルの索引で同じものを使う。
 *
 * - ラベル定義は `名前:`（名前は英字・`_`・`.`・`$` で始まり、英数字・`_`・`.`・`$` が続く）。
 *   `1:` のような数字だけのローカルラベルもラベルとして返す。1 行に複数あってもよい。
 * - ラベルの後ろ（同じ行）に命令やディレクティブを書ける（`m_WalkUp: .byte walk_up, end_m`）。
 * - 命令（マクロ）とディレクティブ（`.` で始まるもの）の後ろは引数。引数は空白とカンマで区切る。
 *   括弧の中と `"..."` の中では区切らない。`a + 1` のように演算子だけの引数をはさむ並びは 1 つの式にまとめる。
 * - `.equ` / `.set` / `.equiv` の引数は 2 つ（名前と、その後ろ全部の値）。
 * - コメントは `@` から行末まで、行の最初の文字（空白の後）が `#` の行、`/* ... *\/`。
 *   `/*` が行内で閉じないときは、次の行に「コメントの中で始まる」状態を引き継ぐ。
 * - `"..."` の中の `@` や `/*` はコメントにしない。
 * - 桁（start / end）は行の文字列の UTF-16 の位置（0 始まり、end は含まない）。
 */
export type AsmTokenKind =
  /** ラベル定義の名前（`:` は含まない）。 */
  | "label"
  /** `.` で始まるディレクティブ（`.byte`、`.include` など）。 */
  | "directive"
  /** 命令またはマクロの名前。 */
  | "mnemonic"
  /** 数値の引数（`0x10`、`12`、`-1`、`0b101`）。 */
  | "number"
  /** 文字列の引数（`"..."`。引用符を含む）。 */
  | "string"
  /** 名前だけの引数（ラベル、`.equ` の定数など）。 */
  | "symbol"
  /** マクロの本文の引数参照（`\destination`）。 */
  | "macroArg"
  /** その他の式（`VAR + 1`、`(1 << 2)`）。 */
  | "expression"
  /** コメント（`@...`、`#...`、`/* ... *\/`。記号を含む）。 */
  | "comment";

/** 1 行の中の 1 つの区間。 */
export interface AsmToken {
  readonly kind: AsmTokenKind;
  /** 始まりの桁（0 始まり）。 */
  readonly start: number;
  /** 終わりの桁（含まない）。 */
  readonly end: number;
}

/** 1 行を解析した結果。 */
export interface AsmLine {
  /** 解析した行（改行は含まない）。 */
  readonly text: string;
  /** すべての区間（桁の順）。空白・カンマ・ラベルの `:` は含まない。 */
  readonly tokens: readonly AsmToken[];
  /** ラベル定義（行の順）。 */
  readonly labels: readonly AsmToken[];
  /** 命令またはディレクティブ。無ければ null。 */
  readonly op: AsmToken | null;
  /** 引数（並びの順）。 */
  readonly args: readonly AsmToken[];
  /** `@` か `#` のコメントの本文（記号の後ろを前後の空白を除いて）。無ければ null。`/* *\/` は含まない。 */
  readonly comment: string | null;
  /** `/* *\/` の中で始まった行か。 */
  readonly startsInBlockComment: boolean;
  /** `/* *\/` の中で終わった行か（次の行に引き継ぐ状態）。 */
  readonly endsInBlockComment: boolean;
}

const CH_TAB = 9;
const CH_SPACE = 32;
const CH_QUOTE = 34;
const CH_HASH = 35;
const CH_DOLLAR = 36;
const CH_LPAREN = 40;
const CH_RPAREN = 41;
const CH_STAR = 42;
const CH_COMMA = 44;
const CH_DOT = 46;
const CH_SLASH = 47;
const CH_0 = 48;
const CH_9 = 57;
const CH_COLON = 58;
const CH_AT = 64;
const CH_LBRACKET = 91;
const CH_BACKSLASH = 92;
const CH_RBRACKET = 93;
const CH_UNDERSCORE = 95;
const CH_LBRACE = 123;
const CH_RBRACE = 125;
const CH_BOM = 0xfeff;

/** 数値の引数（全体が一致するか lastIndex で確かめる）。 */
const NUMBER_RE = /[-+~]?(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|[0-9]+)/y;
/** 名前だけの引数。 */
const SYMBOL_RE = /[A-Za-z_.$][A-Za-z0-9_.$]*/y;
/** 演算子だけの引数（前後の引数と 1 つの式にまとめる）。 */
const OPERATOR_ONLY_RE = /(?:<<|>>|[-+*/%|&^<>]|==|!=|<=|>=|&&|\|\|)/y;

/** 引数を 2 つ（名前と値）として読むディレクティブ。 */
const ASSIGN_DIRECTIVES = new Set([".equ", ".set", ".equiv", ".eqv"]);

/** `.s` の 1 行を解析する。`inBlockComment` は前の行の `endsInBlockComment`。 */
export function parseAsmLine(text: string, inBlockComment = false): AsmLine {
  const len = text.length;
  const comments: AsmToken[] = [];
  let comment: string | null = null;
  let codeEnd = len;
  let masked = false;
  let inBlock = inBlockComment;
  let i = 0;

  // 1. コメントの区間を探す。
  if (inBlock) {
    const close = text.indexOf("*/");
    if (close < 0) {
      if (len > 0) comments.push({ kind: "comment", start: 0, end: len });
      return finish(text, comments, [], null, [], null, true, true);
    }
    comments.push({ kind: "comment", start: 0, end: close + 2 });
    i = close + 2;
    inBlock = false;
    masked = true;
  } else {
    const first = skipSpace(text, 0, len);
    if (first < len && text.charCodeAt(first) === CH_HASH) {
      comments.push({ kind: "comment", start: first, end: len });
      comment = text.slice(first + 1).trim();
      return finish(text, comments, [], null, [], comment, false, false);
    }
  }
  while (i < len) {
    const c = text.charCodeAt(i);
    if (c === CH_QUOTE) {
      i = skipString(text, i, len);
    } else if (c === CH_AT) {
      comments.push({ kind: "comment", start: i, end: len });
      comment = text.slice(i + 1).trim();
      codeEnd = i;
      break;
    } else if (c === CH_SLASH && text.charCodeAt(i + 1) === CH_STAR) {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) {
        comments.push({ kind: "comment", start: i, end: len });
        codeEnd = i;
        inBlock = true;
        break;
      }
      comments.push({ kind: "comment", start: i, end: close + 2 });
      masked = true;
      i = close + 2;
    } else {
      i++;
    }
  }

  // 行の途中の `/* */` は空白に置き換えてから文を読む（桁は変わらない）。
  let src = text;
  if (masked) {
    let out = "";
    let from = 0;
    for (const t of comments) {
      if (t.end > codeEnd) break;
      out += text.slice(from, t.start) + " ".repeat(t.end - t.start);
      from = t.end;
    }
    src = out + text.slice(from);
  }

  // 2. ラベル、命令、引数。
  const labels: AsmToken[] = [];
  const args: AsmToken[] = [];
  let op: AsmToken | null = null;
  let pos = skipSpace(src, 0, codeEnd);
  for (;;) {
    const end = scanName(src, pos, codeEnd);
    if (end > pos && end < codeEnd && src.charCodeAt(end) === CH_COLON) {
      labels.push({ kind: "label", start: pos, end });
      pos = skipSpace(src, end + 1, codeEnd);
      continue;
    }
    break;
  }
  if (pos < codeEnd) {
    let end = pos;
    while (end < codeEnd) {
      const c = src.charCodeAt(end);
      if (isSpace(c) || c === CH_COMMA) break;
      end++;
    }
    const isDirective = src.charCodeAt(pos) === CH_DOT;
    op = { kind: isDirective ? "directive" : "mnemonic", start: pos, end };
    if (isDirective && ASSIGN_DIRECTIVES.has(src.slice(pos, end).toLowerCase())) {
      readAssignArgs(src, end, codeEnd, args);
    } else {
      readArgs(src, end, codeEnd, args);
    }
  }

  const tokens: AsmToken[] = [];
  let ci = 0;
  const pushUntil = (start: number) => {
    while (ci < comments.length && comments[ci]!.start < start) tokens.push(comments[ci++]!);
  };
  for (const t of labels) {
    pushUntil(t.start);
    tokens.push(t);
  }
  if (op) {
    pushUntil(op.start);
    tokens.push(op);
  }
  for (const t of args) {
    pushUntil(t.start);
    tokens.push(t);
  }
  pushUntil(len + 1);
  return finish(text, tokens, labels, op, args, comment, inBlockComment, inBlock);
}

/** 区間の文字列。 */
export function asmTokenText(line: AsmLine, token: AsmToken): string {
  return line.text.slice(token.start, token.end);
}

/** 命令・ディレクティブの名前（ディレクティブは小文字にそろえる）。無ければ null。 */
export function asmOpName(line: AsmLine): string | null {
  if (!line.op) return null;
  const name = asmTokenText(line, line.op);
  return line.op.kind === "directive" ? name.toLowerCase() : name;
}

/**
 * `"..."` の中身（引用符を外し、`\"` `\\` `\n` `\t` を戻す）。引用符で始まらなければそのまま返す。
 * 閉じていない文字列は行末までを中身とする。
 */
export function asmStringValue(raw: string): string {
  if (raw.charCodeAt(0) !== CH_QUOTE) return raw;
  let out = "";
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '"') break;
    if (c === "\\" && i + 1 < raw.length) {
      const n = raw[++i]!;
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
    } else {
      out += c;
    }
  }
  return out;
}

/** `.include "path"` の行なら、そのパス（書いたまま。`../xse_commands.s` など）。違えば null。 */
export function asmIncludePath(line: AsmLine): string | null {
  if (asmOpName(line) !== ".include") return null;
  const arg = line.args[0];
  if (!arg) return null;
  return asmStringValue(asmTokenText(line, arg));
}

/** `.equ name, value`（`.set` / `.equiv` / `.eqv` も）の行なら、名前と値の文字列。違えば null。 */
export function asmEquDefinition(line: AsmLine): { name: string; value: string } | null {
  const op = asmOpName(line);
  if (op === null || !ASSIGN_DIRECTIVES.has(op)) return null;
  const name = line.args[0];
  const value = line.args[1];
  if (!name || !value || name.kind !== "symbol") return null;
  return { name: asmTokenText(line, name), value: asmTokenText(line, value) };
}

/** `.global` / `.globl` の行なら、その名前（複数可）。違えば空。 */
export function asmGlobalNames(line: AsmLine): string[] {
  const op = asmOpName(line);
  if (op !== ".global" && op !== ".globl") return [];
  return line.args.filter((a) => a.kind === "symbol").map((a) => asmTokenText(line, a));
}

function finish(
  text: string,
  tokens: AsmToken[],
  labels: AsmToken[],
  op: AsmToken | null,
  args: AsmToken[],
  comment: string | null,
  startsInBlockComment: boolean,
  endsInBlockComment: boolean,
): AsmLine {
  return { text, tokens, labels, op, args, comment, startsInBlockComment, endsInBlockComment };
}

function isSpace(c: number): boolean {
  return c === CH_SPACE || c === CH_TAB || c === CH_BOM || c === 13 || c === 11 || c === 12;
}

function skipSpace(s: string, i: number, end: number): number {
  while (i < end && isSpace(s.charCodeAt(i))) i++;
  return i;
}

/** `"` の位置から、閉じた `"` の次の位置（閉じていなければ行末）。 */
function skipString(s: string, i: number, end: number): number {
  i++;
  while (i < end) {
    const c = s.charCodeAt(i);
    if (c === CH_BACKSLASH) i += 2;
    else if (c === CH_QUOTE) return i + 1;
    else i++;
  }
  return end;
}

/** ラベルに使える名前の終わり（名前でなければ i のまま）。数字だけの名前（ローカルラベル）も読む。 */
function scanName(s: string, i: number, end: number): number {
  if (i >= end) return i;
  const first = s.charCodeAt(i);
  if (first >= CH_0 && first <= CH_9) {
    let j = i + 1;
    while (j < end && isDigit(s.charCodeAt(j))) j++;
    return j;
  }
  if (!isNameStart(first)) return i;
  let j = i + 1;
  while (j < end && isNamePart(s.charCodeAt(j))) j++;
  return j;
}

function isDigit(c: number): boolean {
  return c >= CH_0 && c <= CH_9;
}

function isNameStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === CH_UNDERSCORE || c === CH_DOT || c === CH_DOLLAR;
}

function isNamePart(c: number): boolean {
  return isNameStart(c) || isDigit(c);
}

/** `.equ` の引数: 名前（最初の空白かカンマまで）と、その後ろ全部（前後の空白を除く）。 */
function readAssignArgs(s: string, i: number, end: number, out: AsmToken[]): void {
  i = skipSpace(s, i, end);
  if (i >= end) return;
  let j = i;
  while (j < end) {
    const c = s.charCodeAt(j);
    if (isSpace(c) || c === CH_COMMA) break;
    j++;
  }
  out.push({ kind: classify(s, i, j), start: i, end: j });
  j = skipSpace(s, j, end);
  if (j < end && s.charCodeAt(j) === CH_COMMA) j = skipSpace(s, j + 1, end);
  let e = end;
  while (e > j && isSpace(s.charCodeAt(e - 1))) e--;
  if (e > j) out.push({ kind: classify(s, j, e), start: j, end: e });
}

/** 一般の引数: 空白とカンマで区切る。括弧と文字列の中では区切らない。 */
function readArgs(s: string, i: number, end: number, out: AsmToken[]): void {
  const first = out.length;
  let start = -1;
  let depth = 0;
  while (i < end) {
    const c = s.charCodeAt(i);
    if (c === CH_QUOTE) {
      if (start < 0) start = i;
      i = skipString(s, i, end);
      continue;
    }
    if (c === CH_LPAREN || c === CH_LBRACKET || c === CH_LBRACE) depth++;
    else if ((c === CH_RPAREN || c === CH_RBRACKET || c === CH_RBRACE) && depth > 0) depth--;
    else if (depth === 0 && (c === CH_COMMA || isSpace(c))) {
      if (start >= 0) {
        out.push({ kind: "expression", start, end: i });
        start = -1;
      }
      i++;
      continue;
    }
    if (start < 0) start = i;
    i++;
  }
  if (start >= 0) out.push({ kind: "expression", start, end });

  // 演算子だけの引数と、演算子で終わる・始まる引数を前後とまとめて 1 つの式にする（`a + 1`、`a+ 1`）。
  let w = first;
  for (let r = first; r < out.length; r++) {
    const cur = out[r]!;
    const prev = w > first ? out[w - 1]! : null;
    if (prev && (endsWithOperator(s, prev) || startsWithBinaryOperator(s, cur)) && onlySpaceBetween(s, prev.end, cur.start)) {
      out[w - 1] = { kind: "expression", start: prev.start, end: cur.end };
    } else {
      out[w++] = cur;
    }
  }
  out.length = w;
  for (let k = first; k < out.length; k++) {
    const t = out[k]!;
    out[k] = { kind: classify(s, t.start, t.end), start: t.start, end: t.end };
  }
}

/** 引数の間がカンマでなく空白だけか（カンマで区切った引数はまとめない）。 */
function onlySpaceBetween(s: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (s.charCodeAt(i) === CH_COMMA) return false;
  return true;
}

function endsWithOperator(s: string, t: AsmToken): boolean {
  const c = s.charCodeAt(t.end - 1);
  if (s.charCodeAt(t.start) === CH_QUOTE) return false;
  return c === 43 || c === 45 || c === CH_STAR || c === CH_SLASH || c === 37 || c === 124 || c === 38 || c === 94 || c === 60 || c === 62 || c === 61;
}

/** 二項演算子で始まるか（`-` と `~` は単項にもなるので含めない。演算子だけの引数は含める）。 */
function startsWithBinaryOperator(s: string, t: AsmToken): boolean {
  OPERATOR_ONLY_RE.lastIndex = t.start;
  if (OPERATOR_ONLY_RE.test(s) && OPERATOR_ONLY_RE.lastIndex === t.end) return true;
  const c = s.charCodeAt(t.start);
  return c === 43 || c === CH_STAR || c === CH_SLASH || c === 37 || c === 124 || c === 38 || c === 94 || c === 60 || c === 62 || c === 61;
}

function classify(s: string, start: number, end: number): AsmTokenKind {
  const c = s.charCodeAt(start);
  if (c === CH_QUOTE) return "string";
  if (c === CH_BACKSLASH) {
    SYMBOL_RE.lastIndex = start + 1;
    if (SYMBOL_RE.test(s) && SYMBOL_RE.lastIndex === end) return "macroArg";
    return "expression";
  }
  NUMBER_RE.lastIndex = start;
  if (NUMBER_RE.test(s) && NUMBER_RE.lastIndex === end) return "number";
  SYMBOL_RE.lastIndex = start;
  if (SYMBOL_RE.test(s) && SYMBOL_RE.lastIndex === end) return "symbol";
  return "expression";
}
