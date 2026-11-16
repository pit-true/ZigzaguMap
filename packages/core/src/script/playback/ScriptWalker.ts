import { asmOpName, asmTokenText, parseAsmLine, type AsmLine } from "../asm/AsmLine.js";
import { splitAsmLines } from "../asm/lineEnding.js";
import { evaluateMacroExpression } from "../commands/macroExpression.js";
import type { MacroDataSize, MacroDefinition, MacroStatement } from "../commands/MacroFile.js";
import type { ScriptCommandTable } from "../commands/ScriptCommandTable.js";
import type { ScriptIndex } from "../index/ScriptIndex.js";

/**
 * スクリプトを実行する順に、命令を 1 つずつ返す部品（#450）。Phase2 の要約（`ScriptSummary`）は重なりを省く幅優先のたどりで、
 * 実行順と条件を持たないので、別に作った。
 *
 * - 1 行ずつ `parseAsmLine` で読み、命令名はプロジェクトの `xse_commands.s` のマクロを中まで展開して、ゲームの命令（命令番号と
 *   引数のバイトの並び）に直す。**命令番号で意味を決める**ので、ND の `cond`、Chronos の `if`、`switch`/`case`、`msgbox` などの
 *   方言の違いはここで吸収される（`case` は compare と goto_if の 2 命令になる）。
 * - 流れ: `end`（0x02）・`return`（0x03）・`call`（0x04）・`goto`（0x05）・`goto_if`（0x06）・`call_if`（0x07）。
 *   `goto_if`・`call_if` は、呼び出し元の関数（{@link BranchDecider}）に飛ぶかどうかを聞く。
 * - 分岐の印は「ファイル・行・その行の何番目の命令か」と「何回目に来たか」で区別する（ループの中の分岐を分けるため）。
 * - 止まるとき: `end`、呼び出し元の無い `return`、`.byte` などのデータに入った、ファイルの終わり、命令 10,000 個、
 *   飛び先のラベルが無い、飛び先が ROM のアドレス（`.s` の外）。
 * - 定義の無いマクロを呼ぶ古い別名（`setobjectxy` → `movesprite`、`turnobject` → `spriteface`）は `moveobject`・`changeface` として
 *   読む。ほかに定義が壊れているマクロ（ND・Chronos の `setescape`・`warppanel2` が呼ぶ `map` など）は、止まらずに注意を出して
 *   次の行へ進む。
 * - `.if` / `.ifdef` / `.ifndef` と `.else` / `.endif` は、値の分かる条件なら外れた側の行を読まない（`.if 0` の中など）。
 */

/** 命令の引数 1 つ（命令番号の後ろのバイトの並びの 1 項目）。 */
export interface WalkArg {
  /** 書いた式（マクロの引数を入れた後のもの。`PLAYER`、`m_WalkUp`、`0x8005` など）。 */
  readonly text: string;
  /** 数に直せた値。ラベルや知らない名前は null。 */
  readonly value: number | null;
  /** バイト数。 */
  readonly size: MacroDataSize;
}

/** スクリプトの中の場所。 */
export interface WalkLocation {
  /** プロジェクトフォルダからのパス。 */
  readonly path: string;
  /** 行（0 始まり）。 */
  readonly line: number;
}

/** たどった命令 1 つ。 */
export interface WalkCommand {
  /** 命令番号。 */
  readonly opcode: number;
  /** 書いてあった命令名（`msgbox`、`case` など）。 */
  readonly written: string;
  /** 展開した先のマクロの名前（`loadpointer`、`cmpvar` など。マクロでなければ書いてあった名前）。 */
  readonly macro: string;
  /** 命令番号の後ろの引数（バイトの並びの順）。 */
  readonly args: readonly WalkArg[];
  /** 元の場所。 */
  readonly path: string;
  readonly line: number;
  /** 命令名の桁（0 始まり、end は含まない）。 */
  readonly start: number;
  readonly end: number;
  /** 1 行が複数の命令になるときの何番目か（0 始まり）。 */
  readonly part: number;
  /** `call` の深さ（始めのラベルが 0）。 */
  readonly depth: number;
  /** 分岐（`goto_if`・`call_if`）なら、その印と選んだ答え。 */
  readonly branch: WalkBranch | null;
}

/** 分岐の印と答え。 */
export interface WalkBranch {
  /** 分岐の場所の印（`path:line:part`）。 */
  readonly key: string;
  /** その場所に来た回数（1 始まり）。 */
  readonly visit: number;
  /** 飛んだか。 */
  readonly taken: boolean;
  /** 飛び先のラベル（書いたまま）。 */
  readonly target: string;
}

/** 止まった理由。 */
export type WalkStopReason =
  | "end"
  | "return"
  | "data"
  | "eof"
  | "limit"
  | "missingLabel"
  | "romPointer"
  /** 始めのラベルが `.if 0` などの外れた側にある（組まれないコード）。 */
  | "inactive";

/** 止まらずに出す注意の種類。 */
export type WalkWarningKind =
  /** 定義が壊れているマクロ（呼び先が無い、本文が読めない）。その行は飛ばした。 */
  | "brokenMacro"
  /** 知らない命令名（マクロに無い）。その行は飛ばした。 */
  | "unknownMacro"
  /** call の飛び先が無いか ROM のアドレスで、たどれなかった（呼んだことにして次へ進む）。 */
  | "callSkipped"
  /** `.if` の条件が分からなかった（中を読んだ）。 */
  | "unknownConditional";

/** たどった結果の 1 件。 */
export type WalkEvent =
  | { readonly type: "command"; readonly command: WalkCommand }
  | { readonly type: "warning"; readonly kind: WalkWarningKind; readonly path: string; readonly line: number; readonly detail: string }
  | { readonly type: "stop"; readonly reason: WalkStopReason; readonly path: string | null; readonly line: number | null; readonly detail: string | null };

/** 分岐の答えを決める関数。true で飛ぶ。 */
export type BranchDecider = (command: WalkCommand, key: string, visit: number) => boolean;

/** 本文の引き方（プロジェクトの `.s` の中身。無ければ null）。 */
export type ScriptTextSource = (path: string) => string | null;

/** たどる設定。 */
export interface ScriptWalkerOptions {
  readonly index: ScriptIndex;
  readonly commands: ScriptCommandTable;
  readonly text: ScriptTextSource;
  /** 命令の数の上限。既定 10,000。 */
  readonly maxCommands?: number;
}

/** 命令の数の上限の既定。 */
export const WALK_MAX_COMMANDS = 10_000;

/** 定義の無いマクロを呼ぶ古い別名の、呼び先の読み替え（A-12）。 */
const MISSING_ALIASES: Readonly<Record<string, string>> = {
  movesprite: "moveobject",
  spriteface: "changeface",
};

/** 読み飛ばすディレクティブ。 */
const SKIP_DIRECTIVES = new Set([
  ".global",
  ".globl",
  ".align",
  ".balign",
  ".p2align",
  ".text",
  ".thumb",
  ".arm",
  ".section",
  ".equ",
  ".set",
  ".equiv",
  ".eqv",
  ".include",
  ".ltorg",
  ".pool",
  ".type",
  ".size",
  ".func",
  ".endfunc",
  ".thumb_func",
  ".code",
]);

/** 命令番号。 */
export const OP_END = 0x02;
export const OP_RETURN = 0x03;
export const OP_CALL = 0x04;
export const OP_GOTO = 0x05;
export const OP_GOTO_IF = 0x06;
export const OP_CALL_IF = 0x07;

/** 展開した命令の素（命令番号を含むバイトの並び）。 */
interface Leaf {
  readonly macro: string;
  readonly fields: { size: MacroDataSize; text: string }[];
}

interface FileLines {
  readonly lines: readonly AsmLine[];
  /** `.if` の外れた側の行か。 */
  readonly inactive: readonly boolean[];
  /** 条件の分からなかった `.if` の行。 */
  readonly unknownIf: readonly number[];
}

interface Frame {
  path: string;
  line: number;
  /** call から戻ったときに先に返す、同じ行の残りの命令。 */
  pending: WalkEvent[];
}

/** ラベルから命令を実行順に返す。 */
export class ScriptWalker {
  private readonly files = new Map<string, FileLines | null>();
  private readonly visits = new Map<string, number>();
  private readonly stack: Frame[] = [];
  private readonly queue: WalkEvent[] = [];
  private pc: Frame | null = null;
  private count = 0;
  private stopped = false;
  private readonly max: number;
  private readonly constCache = new Map<string, number | null>();

  constructor(private readonly options: ScriptWalkerOptions) {
    this.max = options.maxCommands ?? WALK_MAX_COMMANDS;
  }

  /** 始めのラベルの場所。無ければ null。 */
  locate(label: string): WalkLocation | null {
    const l = this.options.index.findLabel(label);
    return l ? { path: l.path, line: l.line - 1 } : null;
  }

  /** 始める。ラベルが無ければ、最初の next() が止まる。 */
  start(label: string): void {
    this.reset();
    const loc = this.locate(label);
    if (!loc) {
      this.queue.push({ type: "stop", reason: "missingLabel", path: null, line: null, detail: label });
      return;
    }
    if (this.load(loc.path)?.inactive[loc.line]) {
      this.queue.push({ type: "stop", reason: "inactive", path: loc.path, line: loc.line, detail: label });
      return;
    }
    this.pc = { ...loc, pending: [] };
  }

  /** 場所から始める。 */
  startAt(loc: WalkLocation): void {
    this.reset();
    this.pc = { ...loc, pending: [] };
  }

  private reset(): void {
    this.visits.clear();
    this.stack.length = 0;
    this.queue.length = 0;
    this.count = 0;
    this.stopped = false;
    this.pc = null;
  }

  /** 次の 1 件。止まった後は同じ stop を返し続ける。 */
  next(decide: BranchDecider): WalkEvent {
    for (;;) {
      const queued = this.queue.shift();
      if (queued) {
        if (queued.type === "command") return this.flow(queued.command, decide);
        if (queued.type === "stop") {
          this.stopped = true;
          this.last = queued;
        }
        return queued;
      }
      if (this.stopped || !this.pc) return this.last ?? this.stop("eof", null, null, null);
      this.fetch();
    }
  }

  private last: WalkEvent | null = null;

  private stop(reason: WalkStopReason, path: string | null, line: number | null, detail: string | null): WalkEvent {
    const e: WalkEvent = { type: "stop", reason, path, line, detail };
    this.stopped = true;
    this.last = e;
    this.queue.length = 0;
    return e;
  }

  /** 命令の流れ（飛ぶ・戻る・止まる）を処理して、その命令を返す。 */
  private flow(cmd: WalkCommand, decide: BranchDecider): WalkEvent {
    this.count++;
    if (this.count > this.max) return this.stop("limit", cmd.path, cmd.line, String(this.max));
    const op = cmd.opcode;
    if (op === OP_END) {
      this.queue.push({ type: "stop", reason: "end", path: cmd.path, line: cmd.line, detail: null });
      this.pc = null;
      return { type: "command", command: cmd };
    }
    if (op === OP_RETURN) {
      const back = this.stack.pop();
      if (!back) {
        this.queue.push({ type: "stop", reason: "return", path: cmd.path, line: cmd.line, detail: null });
        this.pc = null;
      } else {
        this.queue.length = 0;
        this.queue.push(...back.pending);
        this.pc = { path: back.path, line: back.line, pending: [] };
      }
      return { type: "command", command: cmd };
    }
    if (op === OP_CALL || op === OP_GOTO || op === OP_GOTO_IF || op === OP_CALL_IF) {
      const conditional = op === OP_GOTO_IF || op === OP_CALL_IF;
      const targetArg = cmd.args[conditional ? 1 : 0];
      const target = targetArg?.text ?? "";
      let command = cmd;
      let jump = true;
      if (conditional) {
        const key = `${cmd.path}:${cmd.line}:${cmd.part}`;
        const visit = (this.visits.get(key) ?? 0) + 1;
        this.visits.set(key, visit);
        jump = decide(cmd, key, visit);
        command = { ...cmd, branch: { key, visit, taken: jump, target } };
      }
      if (!jump) return { type: "command", command };
      const isCall = op === OP_CALL || op === OP_CALL_IF;
      const dest = this.locate(target);
      if (!dest) {
        const reason: WalkStopReason = targetArg?.value !== null && targetArg?.value !== undefined ? "romPointer" : "missingLabel";
        if (isCall) {
          this.queue.unshift({ type: "warning", kind: "callSkipped", path: cmd.path, line: cmd.line, detail: target });
          return { type: "command", command };
        }
        this.queue.length = 0;
        this.queue.push({ type: "stop", reason, path: cmd.path, line: cmd.line, detail: target });
        this.pc = null;
        return { type: "command", command };
      }
      if (isCall) {
        // 戻り先は次の行（今の行の残りの命令は、戻ったときに先に返す）。
        this.stack.push({ path: this.pc?.path ?? cmd.path, line: this.pc?.line ?? cmd.line + 1, pending: this.queue.splice(0) });
      } else {
        this.queue.length = 0;
      }
      this.pc = { path: dest.path, line: dest.line, pending: [] };
      return { type: "command", command };
    }
    return { type: "command", command: cmd };
  }

  /** 今の場所から次の命令のある行を読み、展開した命令を queue に積む。 */
  private fetch(): void {
    const pc = this.pc!;
    const file = this.load(pc.path);
    if (!file) {
      this.queue.push({ type: "stop", reason: "eof", path: pc.path, line: pc.line, detail: null });
      return;
    }
    for (let i = pc.line; i < file.lines.length; i++) {
      if (file.inactive[i]) continue;
      const line = file.lines[i]!;
      if (file.unknownIf.includes(i)) {
        this.queue.push({ type: "warning", kind: "unknownConditional", path: pc.path, line: i, detail: line.text.trim() });
      }
      if (!line.op) continue;
      const op = asmOpName(line)!;
      if (line.op.kind === "directive") {
        if (SKIP_DIRECTIVES.has(op) || /^\.(if|ifdef|ifndef|else|elseif|endif)$/.test(op)) continue;
        this.queue.push({ type: "stop", reason: "data", path: pc.path, line: i, detail: op });
        this.pc = { path: pc.path, line: i, pending: [] };
        return;
      }
      this.pc = { path: pc.path, line: i + 1, pending: [] };
      this.expandLine(pc.path, i, line);
      return;
    }
    this.queue.push({ type: "stop", reason: "eof", path: pc.path, line: file.lines.length, detail: null });
  }

  /** 1 行の命令を展開して積む。 */
  private expandLine(path: string, lineNo: number, line: AsmLine): void {
    const written = asmTokenText(line, line.op!);
    const args = line.args.map((a) => asmTokenText(line, a));
    const result = this.expand(written, args, 0);
    if (result.problem) {
      const known = this.options.commands.get(written)?.macro;
      this.queue.push({ type: "warning", kind: known ? "brokenMacro" : "unknownMacro", path, line: lineNo, detail: result.problem });
      return;
    }
    let part = 0;
    for (const leaf of result.leaves) {
      for (const fields of this.splitLeaf(leaf)) {
        const first = fields[0];
        const opcode = first && first.size === 1 ? this.evaluate(first.text) : null;
        if (opcode === null) {
          this.queue.push({ type: "warning", kind: "brokenMacro", path, line: lineNo, detail: `${written}: 命令番号が分かりません（${first?.text ?? ""}）` });
          continue;
        }
        this.queue.push({
          type: "command",
          command: {
            opcode,
            written,
            macro: leaf.macro,
            args: fields.slice(1).map((f) => ({ text: f.text, value: this.evaluate(f.text), size: f.size })),
            path,
            line: lineNo,
            start: line.op!.start,
            end: line.op!.end,
            part: part++,
            depth: this.stack.length,
            branch: null,
          },
        });
      }
    }
  }

  /**
   * 1 つのマクロの中に命令が 2 つ以上並んでいるとき（`.byte 0x6A` `.byte 0x5A` など）、命令表の長さで分ける。
   * 長さの決まらない命令番号なら分けない。
   */
  private splitLeaf(leaf: Leaf): Leaf["fields"][] {
    const out: Leaf["fields"][] = [];
    let rest = leaf.fields;
    while (rest.length > 0) {
      const op = rest[0]!.size === 1 ? this.evaluate(rest[0]!.text) : null;
      const size = op === null ? null : this.commandSize(op);
      const total = rest.reduce((n, f) => n + f.size, 0);
      if (size === null || size >= total) {
        out.push(rest);
        break;
      }
      let bytes = 0;
      let k = 0;
      while (k < rest.length && bytes < size) bytes += rest[k++]!.size;
      if (bytes !== size) {
        out.push(rest);
        break;
      }
      out.push(rest.slice(0, k));
      rest = rest.slice(k);
    }
    return out;
  }

  private readonly sizeCache = new Map<number, number | null>();

  /**
   * 命令番号の長さ。命令表の直接書いたマクロ（`.byte` などだけのもの）の長さのうち、いちばん多いもの（同じ数なら短い方）。
   * 2 命令をまとめたマクロ（`lockfaceplayer` など）も直接書いたマクロに入るので、多数決で選ぶ。
   */
  private commandSize(op: number): number | null {
    if (this.sizeCache.has(op)) return this.sizeCache.get(op)!;
    const votes = new Map<number, number>();
    for (const m of this.options.commands.findByOpcode(op)) {
      if (m.command.layout?.composition !== "direct") continue;
      votes.set(m.variant.size, (votes.get(m.variant.size) ?? 0) + 1);
    }
    let size: number | null = null;
    let best = 0;
    for (const [s, n] of [...votes].sort((a, b) => a[0] - b[0])) {
      if (n > best) {
        best = n;
        size = s;
      }
    }
    this.sizeCache.set(op, size);
    return size;
  }

  /** マクロの呼び出しを、命令の素の並びに展開する。 */
  private expand(name: string, args: readonly string[], depth: number): { leaves: Leaf[]; problem: string | null } {
    if (depth > 32) return { leaves: [], problem: `マクロの呼び出しが深すぎます（${name}）` };
    const def = this.findMacro(name);
    if (!def) return { leaves: [], problem: `マクロ ${name} が見つかりません` };
    if (!def.body) return { leaves: [], problem: `マクロ ${def.name} が読めません${def.error ? `（${def.error}）` : ""}` };
    const scope = new Map<string, string>();
    for (let i = 0; i < def.params.length; i++) {
      const p = def.params[i]!;
      let v = p.vararg ? args.slice(i).join(", ") : (args[i] ?? "");
      if (v.trim() === "" && p.defaultValue !== undefined) v = p.defaultValue;
      if (v.trim() === "" && p.required) return { leaves: [], problem: `${def.name} に必須の引数 ${p.name} がありません` };
      scope.set(p.name, v);
    }
    const leaves: Leaf[] = [];
    let current: Leaf | null = null;
    const run = (stmts: readonly MacroStatement[]): string | null => {
      for (const s of stmts) {
        if (s.type === "data") {
          current ??= { macro: def.name, fields: [] };
          for (const v of s.values) current.fields.push({ size: s.size, text: substitute(v, scope) });
          continue;
        }
        if (s.type === "ifBlank") {
          const blank = substitute(s.test, scope).trim() === "";
          const p = run(blank === s.blank ? s.then : s.else);
          if (p) return p;
          continue;
        }
        if (current) {
          leaves.push(current);
          current = null;
        }
        const inner = this.expand(s.name, s.args.map((a) => substitute(a, scope)), depth + 1);
        if (inner.problem) return `${def.name} → ${inner.problem}`;
        leaves.push(...inner.leaves);
      }
      return null;
    };
    const problem = run(def.body);
    if (problem) return { leaves: [], problem };
    if (current) leaves.push(current);
    return { leaves, problem: null };
  }

  private findMacro(name: string): MacroDefinition | undefined {
    const t = this.options.commands;
    return t.get(name)?.macro ?? (MISSING_ALIASES[name.toLowerCase()] ? t.get(MISSING_ALIASES[name.toLowerCase()]!)?.macro : undefined) ?? undefined;
  }

  /** 式を数にする（命令表の定数、プロジェクトの `.equ`）。ラベルや知らない名前は null。 */
  evaluate(text: string): number | null {
    return evaluateMacroExpression(text.trim(), (n) => this.constant(n));
  }

  private constant(name: string): number | null {
    if (this.constCache.has(name)) return this.constCache.get(name)!;
    this.constCache.set(name, null);
    let v = this.options.commands.resolveConstant(name);
    if (v === null) {
      const equ = this.options.index.findEqu(name);
      if (equ) v = evaluateMacroExpression(equ.value, (n) => this.constant(n));
    }
    this.constCache.set(name, v);
    return v;
  }

  private load(path: string): FileLines | null {
    if (this.files.has(path)) return this.files.get(path)!;
    const text = this.options.text(path);
    const file = text === null ? null : this.prepare(text);
    this.files.set(path, file);
    return file;
  }

  /** 行を読み、`.if` の外れた側の行に印を付ける。 */
  private prepare(text: string): FileLines {
    const rows = splitAsmLines(text);
    const lines: AsmLine[] = [];
    let inBlock = false;
    for (const r of rows) {
      const l = parseAsmLine(r, inBlock);
      lines.push(l);
      inBlock = l.endsInBlockComment;
    }
    const inactive: boolean[] = new Array<boolean>(lines.length).fill(false);
    const unknownIf: number[] = [];
    // 段ごとの { 親が有効か, この段の今の側が有効か, もう有効な側があったか }。
    const stack: { parent: boolean; active: boolean; done: boolean }[] = [];
    const enabled = () => (stack.length === 0 ? true : stack[stack.length - 1]!.parent && stack[stack.length - 1]!.active);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const op = l.op && l.op.kind === "directive" ? asmOpName(l) : null;
      if (op === ".if" || op === ".ifdef" || op === ".ifndef") {
        const parent = enabled();
        const cond = this.condition(op, l);
        if (cond === null && parent) unknownIf.push(i);
        const active = cond ?? true;
        stack.push({ parent, active, done: active });
        continue;
      }
      if (op === ".elseif" && stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const cond = this.condition(".if", l);
        top.active = !top.done && (cond ?? true);
        top.done ||= top.active;
        continue;
      }
      if (op === ".else" && stack.length > 0) {
        const top = stack[stack.length - 1]!;
        top.active = !top.done;
        top.done = true;
        continue;
      }
      if (op === ".endif" && stack.length > 0) {
        stack.pop();
        continue;
      }
      inactive[i] = !enabled();
    }
    return { lines, inactive, unknownIf };
  }

  /** `.if` の条件。分からなければ null。 */
  private condition(op: string, line: AsmLine): boolean | null {
    const text = line.args.map((a) => asmTokenText(line, a)).join(" ").trim();
    if (op === ".ifdef" || op === ".ifndef") {
      const defined = this.constant(text) !== null || this.options.index.findLabel(text) !== undefined;
      return op === ".ifdef" ? defined : !defined;
    }
    const v = this.evaluate(text);
    return v === null ? null : v !== 0;
  }
}

const PARAM_REF = /\\([A-Za-z_][A-Za-z0-9_]*)(\(\))?/g;

function substitute(text: string, scope: ReadonlyMap<string, string>): string {
  return text.replace(PARAM_REF, (all, name: string) => scope.get(name) ?? all);
}

/** 止まるまでたどった並び（テストと、全体を先に見るとき用）。 */
export function walkScript(walker: ScriptWalker, label: string, decide: BranchDecider = () => false): WalkEvent[] {
  walker.start(label);
  const out: WalkEvent[] = [];
  for (;;) {
    const e = walker.next(decide);
    out.push(e);
    if (e.type === "stop") return out;
  }
}
