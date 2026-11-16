import { evaluateMacroExpression } from "../script/commands/macroExpression.js";

/**
 * C のソースの小さな読み手（Phase6 #432）。CFRU の `dns_data.h` のような、定数の表を読むためのもの。
 *
 * - コメントを外し、`#if 0`・`#ifdef`・`#ifndef`・`#else`・`#elif`・`#endif` で使われない行を空にする（行の数は変えない）。
 * - 引数の無い `#define 名前 値` を集める。
 * - `名前[…] = { … };` の初期化子を、指示子（`[n] =`・`.名前 =`）つきの木にする。
 * - 式は `RGB(r, g, b)`・`TRUE`・`FALSE` と `#define` の名前を数にして、`evaluateMacroExpression` で計算する。
 *
 * C の全部は読まない。読めない所は null を返し、呼ぶ側が理由（ファイルと行）を出す。
 */

/** 初期化子の値。式（そのままの文字列）か、`{ … }` の並び。 */
export type CInit = string | CInitList;

/** `{ … }` の並び。 */
export interface CInitList {
  readonly items: readonly CInitItem[];
  /** `{` のある行（1 から）。 */
  readonly line: number;
}

/** 並びの 1 件。`[n] =` なら index、`.名前 =` なら field に、指示子の中身が入る。 */
export interface CInitItem {
  readonly index?: string;
  readonly field?: string;
  readonly value: CInit;
  /** 値の始まりの行（1 から）。 */
  readonly line: number;
}

/** 前処理をしたソース。 */
export interface CSource {
  /** コメントと使われない行を空白にした本文（行と桁の位置は元と同じ）。 */
  readonly text: string;
  /** 使われる行にある、引数の無い `#define`（名前 → 値の文字列）。先に書かれたものを残す。 */
  readonly defines: ReadonlyMap<string, string>;
}

/** コメントを外す（行の数と桁は変えない）。文字列の中は見ない（表のファイルには文字列が出てこないため）。 */
export function stripCComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

const DIRECTIVE_RE = /^\s*#\s*(\w+)\s*(.*)$/;
const DEFINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)(\(?)(.*)$/;

/**
 * 前処理をする。`defined` は、このファイルの外で定義されている名前（`#ifdef` の判定に使う。値は `#if` の式に使う）。
 * 行の終わりの `\` で続く `#define` は 1 つにつなげる。
 */
export function preprocessC(text: string, defined: ReadonlyMap<string, string> = new Map()): CSource {
  const lines = stripCComments(text).split("\n");
  const defines = new Map<string, string>();
  const known = (name: string) => defines.has(name) || defined.has(name);
  /** 入れ子の #if ごとに、[今の区間が使われるか, それより前の区間のどれかが使われたか, 外側が使われるか]。 */
  const stack: { active: boolean; taken: boolean; outer: boolean }[] = [];
  const active = () => stack.length === 0 || stack[stack.length - 1]!.active;
  const evaluate = (expr: string): boolean => {
    const replaced = expr.replace(/\bdefined\s*\(\s*(\w+)\s*\)|\bdefined\s+(\w+)/g, (_m, a: string | undefined, b: string | undefined) => (known((a ?? b)!) ? "1" : "0"));
    const one = (part: string): boolean => {
      const value = evaluateCExpression(part, (name) => {
        const v = defines.get(name) ?? defined.get(name);
        return v === undefined ? 0 : evaluateCExpression(v, () => 0);
      });
      return (value ?? 0) !== 0;
    };
    // 「||」と「&&」は括弧の外のものだけ分ける（設定のファイルの #if はこの程度の形しか無い）
    return replaced.split("||").some((or) => or.split("&&").every(one));
  };
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i]!.replace(/\r$/, "");
    const directive = DIRECTIVE_RE.exec(raw);
    if (!directive) {
      if (!active()) lines[i] = blank(lines[i]!);
      continue;
    }
    // 行の終わりの「\」でつながる行をまとめる（つないだ行は空にする）
    let j = i;
    while (raw.endsWith("\\") && j + 1 < lines.length) {
      j++;
      raw = raw.slice(0, -1) + " " + lines[j]!.replace(/\r$/, "");
      lines[j] = blank(lines[j]!);
    }
    const [, name, restRaw] = DIRECTIVE_RE.exec(raw)!;
    const rest = restRaw!.trim();
    const outer = active();
    switch (name) {
      case "if":
        stack.push(enter(outer, outer && evaluate(rest)));
        break;
      case "ifdef":
        stack.push(enter(outer, outer && known(rest.split(/\s/)[0]!)));
        break;
      case "ifndef":
        stack.push(enter(outer, outer && !known(rest.split(/\s/)[0]!)));
        break;
      case "elif": {
        const top = stack[stack.length - 1];
        if (top) {
          top.active = top.outer && !top.taken && evaluate(rest);
          top.taken ||= top.active;
        }
        break;
      }
      case "else": {
        const top = stack[stack.length - 1];
        if (top) {
          top.active = top.outer && !top.taken;
          top.taken = true;
        }
        break;
      }
      case "endif":
        stack.pop();
        break;
      case "define":
        if (outer) {
          const d = DEFINE_RE.exec(rest);
          if (d && d[2] === "" && !defines.has(d[1]!)) defines.set(d[1]!, d[3]!.trim());
        }
        break;
      case "undef":
        if (outer) defines.delete(rest.split(/\s/)[0]!);
        break;
      default:
        break;
    }
    lines[i] = blank(lines[i]!);
  }
  return { text: lines.join("\n"), defines };
}

function enter(outer: boolean, active: boolean): { active: boolean; taken: boolean; outer: boolean } {
  return { active, taken: active, outer };
}

function blank(line: string): string {
  return line.replace(/[^\r]/g, " ");
}

/** 位置 `pos` の行（1 から）。 */
export function lineAt(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * `名前[…] = { … }` の初期化子を読む。見つからなければ null、形が崩れていれば `{ error, line }`。
 * `defines` に `{` で始まる値の名前（`TILESET_PAL_FADE_END` のようなもの）があれば、並びとして読む。
 */
export function readCArray(source: CSource, name: string): { init: CInitList; line: number } | { error: string; line: number } | null {
  const re = new RegExp(`\\b${name}\\s*(?:\\[[^\\]]*\\]\\s*)*=\\s*\\{`, "g");
  const m = re.exec(source.text);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  const parser = new InitParser(source.text, source.defines);
  try {
    return { init: parser.list(start), line: lineAt(source.text, m.index) };
  } catch (e) {
    if (e instanceof InitError) return { error: e.message, line: lineAt(source.text, e.pos) };
    throw e;
  }
}

class InitError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
  }
}

class InitParser {
  /** 各行の始まりの位置（行の番号を引くため）。 */
  private readonly starts: number[] = [0];

  constructor(
    private readonly text: string,
    private readonly defines: ReadonlyMap<string, string>,
  ) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }

  private lineOf(pos: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** `pos` の `{` から、対応する `}` までを読む。 */
  list(pos: number): CInitList {
    const t = this.text;
    const line = this.lineOf(pos);
    const items: CInitItem[] = [];
    let i = pos + 1;
    for (;;) {
      i = this.skip(i);
      if (i >= t.length) throw new InitError("「}」が無い", pos);
      if (t[i] === "}") {
        this.end = i + 1;
        return { items, line };
      }
      let index: string | undefined;
      let field: string | undefined;
      if (t[i] === "[") {
        const close = t.indexOf("]", i);
        if (close < 0) throw new InitError("「]」が無い", i);
        index = t.slice(i + 1, close).trim();
        i = this.expect(this.skip(close + 1), "=");
      } else if (t[i] === ".") {
        const f = /^\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(t.slice(i, i + 200));
        if (!f) throw new InitError("「.名前 =」が読めない", i);
        field = f[1];
        i += f[0].length;
      }
      i = this.skip(i);
      const valueLine = this.lineOf(i);
      let value: CInit;
      if (t[i] === "{") {
        value = this.list(i);
        i = this.end;
      } else {
        const [expr, next] = this.expression(i);
        if (expr === "") throw new InitError("値が無い", i);
        const macro = /^[A-Za-z_][A-Za-z0-9_]*$/.test(expr) ? this.defines.get(expr) : undefined;
        value = macro !== undefined && macro.startsWith("{") ? new InitParser(macro, this.defines).list(0) : expr;
        i = next;
      }
      items.push({ ...(index !== undefined ? { index } : {}), ...(field !== undefined ? { field } : {}), value, line: valueLine });
      i = this.skip(i);
      if (t[i] === ",") i++;
      else if (t[i] !== "}") throw new InitError("「,」か「}」が要る", i);
    }
  }

  /** 直前の list が読み終えた位置（`}` の次）。 */
  private end = 0;

  /** 括弧の外の「,」か「}」までを式として読む。 */
  private expression(pos: number): [string, number] {
    const t = this.text;
    let depth = 0;
    let i = pos;
    for (; i < t.length; i++) {
      const c = t[i]!;
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (depth === 0 && (c === "," || c === "}")) break;
      else if (c === "{" || c === ";") throw new InitError("式の中に「" + c + "」がある", i);
    }
    return [t.slice(pos, i).trim(), i];
  }

  private skip(pos: number): number {
    let i = pos;
    while (i < this.text.length && /\s/.test(this.text[i]!)) i++;
    return i;
  }

  private expect(pos: number, c: string): number {
    if (this.text[pos] !== c) throw new InitError(`「${c}」が要る`, pos);
    return pos + 1;
  }
}

/**
 * C の式を数にする。`RGB(r, g, b)`（BGR555）・`TRUE`・`FALSE`・数の後ろの `u`・`l` を扱い、ほかの名前は `resolve` で引く。
 * 読めなければ null。
 */
export function evaluateCExpression(expr: string, resolve: (name: string) => number | null): number | null {
  const expanded = expandRgb(expr.replace(/(?<=\b(?:0x[0-9a-fA-F]+|\d+))[uUlL]+\b/g, ""), resolve);
  if (expanded === null) return null;
  return evaluateMacroExpression(expanded, (name) => (name === "TRUE" ? 1 : name === "FALSE" ? 0 : resolve(name)));
}

/** `RGB(r, g, b)` を数に置き換える（中の式も計算する）。 */
function expandRgb(expr: string, resolve: (name: string) => number | null): string | null {
  let out = expr;
  for (;;) {
    const m = /\bRGB\s*\(/.exec(out);
    if (!m) return out;
    let depth = 1;
    let i = m.index + m[0].length;
    const args: string[] = [];
    let argStart = i;
    for (; i < out.length && depth > 0; i++) {
      const c = out[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      if ((c === "," && depth === 1) || depth === 0) {
        args.push(out.slice(argStart, i));
        argStart = i + 1;
      }
    }
    if (depth !== 0 || args.length !== 3) return null;
    const v = args.map((a) => evaluateCExpression(a, resolve));
    if (v.some((x) => x === null)) return null;
    const [r, g, b] = v as number[];
    const color = (r! & 0x1f) | ((g! & 0x1f) << 5) | ((b! & 0x1f) << 10);
    out = out.slice(0, m.index) + String(color) + out.slice(i);
  }
}

/** `enum 名前 { A, B = 3, C, }` の名前と値。見つからなければ null。 */
export function readCEnum(source: CSource, name: string): Map<string, number> | null {
  const m = new RegExp(`\\benum\\s+${name}\\s*\\{([^}]*)\\}`).exec(source.text);
  if (!m) return null;
  const out = new Map<string, number>();
  let next = 0;
  for (const part of m[1]!.split(",")) {
    const p = part.trim();
    if (p === "") continue;
    const [n, v] = p.split("=").map((s) => s.trim());
    if (v !== undefined) {
      const value = evaluateCExpression(v, (x) => out.get(x) ?? null);
      if (value === null) return null;
      next = value;
    }
    out.set(n!, next++);
  }
  return out;
}
