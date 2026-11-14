/**
 * マクロの本文を展開して、命令のバイトの並びを作る。
 * 別のマクロの呼び出しは中まで展開し、`.ifb` / `.ifnb` の分岐は「どの引数を省いたか」ごとの並び（型）に分ける。
 * 逆アセンブル（#205）は、この並びを使って ROM のバイト列を命令と引数に戻す。
 */

import { evaluateMacroExpression } from "./macroExpression.js";
import type { MacroDataSize, MacroDefinition, MacroStatement } from "./MacroFile.js";

/** 並びの 1 項目。 */
export type MacroField =
  /** 決まった値（命令番号や、マクロの中に書いた定数）。 */
  | { kind: "const"; size: MacroDataSize; value: number }
  /** 引数の値をそのまま書く。paramIndex はマクロの引数の番号（0 始まり）。 */
  | { kind: "arg"; size: MacroDataSize; param: string; paramIndex: number }
  /** 引数を使った式（`\x + 1` など）。逆アセンブルでは引数に戻せない。 */
  | { kind: "expr"; size: MacroDataSize; text: string; params: string[] }
  /** マクロの中に書いたラベルなど、値の決まらない名前。 */
  | { kind: "symbol"; size: MacroDataSize; text: string };

/** 分岐の条件。blank=true は「その引数を省いた」。 */
export interface MacroCondition {
  param: string;
  paramIndex: number;
  blank: boolean;
}

/** 分岐ごとの並び（型）。分岐の無いマクロは型が 1 つ。 */
export interface MacroVariant {
  /** この型になる条件。全部を満たすとき。空なら無条件。 */
  conditions: MacroCondition[];
  fields: MacroField[];
  /** バイト数。 */
  size: number;
  /** 先頭が 1 バイトの決まった値なら、その値（命令番号）。 */
  opcode: number | null;
}

/** マクロ 1 つのバイトの並び。 */
export interface MacroLayout {
  variants: MacroVariant[];
  /** どの型でも同じ命令番号なら、その値。型で違うか、先頭が決まらなければ null。 */
  opcode: number | null;
  /** 型ごとの命令番号（重なりなし、出てくる順）。 */
  opcodes: number[];
  /** どの型でも同じバイト数なら、その値。違えば null。 */
  size: number | null;
  minSize: number;
  maxSize: number;
  /**
   * 本文の作り。direct は `.byte` などだけで書いた命令、alias は別のマクロ 1 つを呼ぶだけの別名
   * （aliasOf に呼び先）、compound は複数の命令をまとめたもの（msgbox など）。
   * 逆アセンブルでは direct を使い、compound は先頭の命令番号が同じでも 1 命令とはみなさない。
   */
  composition: "direct" | "alias" | "compound";
  /** alias の呼び先のマクロの名前。それ以外は null。 */
  aliasOf: string | null;
}

/** 本文の作りを調べる（分岐ごとに見て、いちばん多い呼び出しの数で決める）。 */
function composition(stmts: MacroStatement[]): { data: boolean; calls: string[] } {
  let data = false;
  let calls: string[] = [];
  for (const s of stmts) {
    if (s.type === "data") data = true;
    else if (s.type === "call") calls.push(s.name.toLowerCase());
    else {
      const a = composition(s.then);
      const b = composition(s.else);
      data ||= a.data || b.data;
      const more = a.calls.length >= b.calls.length ? a.calls : b.calls;
      // 分岐で呼び先が違えば、別名とはみなさない。
      const differs = a.calls.length === 1 && b.calls.length === 1 && a.calls[0] !== b.calls[0];
      calls = [...calls, ...more, ...(differs ? ["?"] : [])];
    }
  }
  return { data, calls };
}

/** 展開の結果。読めなければ error。 */
export type MacroLayoutResult = { layout: MacroLayout } | { error: string };

/** 展開で使う、マクロと定数の引き方。 */
export interface MacroLayoutContext {
  /** 名前（大文字小文字を区別しない）からマクロを引く。 */
  findMacro(name: string): MacroDefinition | undefined;
  /** 定数の名前を数に直す。知らなければ null。 */
  resolveConstant(name: string): number | null;
}

/** 呼び出しの深さの上限（自分を呼ぶマクロで止まらないように）。 */
const MAX_DEPTH = 32;
/** 型の数の上限。 */
const MAX_VARIANTS = 64;

interface State {
  conditions: MacroCondition[];
  fields: MacroField[];
}

class LayoutError extends Error {}

const PARAM_REF = /\\([A-Za-z_][A-Za-z0-9_]*)(\(\))?/g;

/** 外側のマクロの引数（`\名前`）の一覧を返す。 */
function referencedParams(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(PARAM_REF)) if (!names.includes(m[1]!)) names.push(m[1]!);
  return names;
}

/** マクロ 1 つのバイトの並びを作る。 */
export function buildMacroLayout(macro: MacroDefinition, context: MacroLayoutContext): MacroLayoutResult {
  if (!macro.body) return { error: macro.error ?? "本文が読めません" };
  const top = macro.params;
  const topIndex = new Map(top.map((p, i) => [p.name, i]));

  // 外側のマクロの引数は、`\名前` のまま持ち回る。
  const bindings = new Map<string, string>(top.map((p) => [p.name, `\\${p.name}`]));

  const substitute = (text: string, scope: Map<string, string>, owner: string): string =>
    text.replace(PARAM_REF, (_all, name: string) => {
      const v = scope.get(name);
      if (v === undefined) throw new LayoutError(`${owner} の本文の \\${name} は引数にありません`);
      return v;
    });

  /** `.ifb` の対象が空か。外側の引数次第なら、その引数の名前。 */
  const blankness = (text: string): boolean | string => {
    const t = text.trim();
    if (t === "") return true;
    const m = /^\\([A-Za-z_][A-Za-z0-9_]*)$/.exec(t);
    if (m && topIndex.has(m[1]!)) {
      const p = top[topIndex.get(m[1]!)!]!;
      // 既定値のある引数は、省いても既定値が入るので空にならない。
      if (p.defaultValue !== undefined && p.defaultValue !== "") return false;
      return m[1]!;
    }
    return false;
  };

  const toField = (size: MacroDataSize, text: string): MacroField => {
    const t = text.trim();
    const ref = /^\\([A-Za-z_][A-Za-z0-9_]*)$/.exec(t);
    if (ref && topIndex.has(ref[1]!)) return { kind: "arg", size, param: ref[1]!, paramIndex: topIndex.get(ref[1]!)! };
    const params = referencedParams(t);
    if (params.length > 0) return { kind: "expr", size, text: t, params };
    const value = evaluateMacroExpression(t, (name) => context.resolveConstant(name));
    if (value !== null) return { kind: "const", size, value: size === 4 ? value : value & ((1 << (size * 8)) - 1) };
    return { kind: "symbol", size, text: t };
  };

  const run = (
    stmts: MacroStatement[],
    scope: Map<string, string>,
    owner: string,
    states: State[],
    chain: string[],
  ): State[] => {
    let current = states;
    for (const stmt of stmts) {
      if (stmt.type === "data") {
        const fields = stmt.values.map((v) => toField(stmt.size, substitute(v, scope, owner)));
        for (const s of current) s.fields.push(...fields);
        continue;
      }
      if (stmt.type === "ifBlank") {
        const b = blankness(substitute(stmt.test, scope, owner));
        if (typeof b === "boolean") {
          current = run(b === stmt.blank ? stmt.then : stmt.else, scope, owner, current, chain);
          continue;
        }
        const index = topIndex.get(b)!;
        const next: State[] = [];
        const yes: State[] = [];
        const no: State[] = [];
        for (const s of current) {
          const known = s.conditions.find((c) => c.param === b);
          if (known) {
            (known.blank === stmt.blank ? yes : no).push(s);
            continue;
          }
          yes.push({ conditions: [...s.conditions, { param: b, paramIndex: index, blank: stmt.blank }], fields: [...s.fields] });
          no.push({ conditions: [...s.conditions, { param: b, paramIndex: index, blank: !stmt.blank }], fields: [...s.fields] });
        }
        next.push(...run(stmt.then, scope, owner, yes, chain), ...run(stmt.else, scope, owner, no, chain));
        if (next.length > MAX_VARIANTS) throw new LayoutError(`分岐の組み合わせが ${MAX_VARIANTS} を超えます`);
        current = next;
        continue;
      }
      // 別のマクロの呼び出し。
      const callee = context.findMacro(stmt.name);
      if (!callee) throw new LayoutError(`${stmt.line} 行目で呼んでいるマクロ ${stmt.name} が見つかりません`);
      if (!callee.body) throw new LayoutError(`${stmt.line} 行目で呼んでいるマクロ ${callee.name} が読めません`);
      if (chain.includes(callee.name.toLowerCase())) {
        throw new LayoutError(`${stmt.line} 行目で ${callee.name} が自分を呼び出しています（${[...chain, callee.name.toLowerCase()].join(" → ")}）`);
      }
      if (chain.length >= MAX_DEPTH) throw new LayoutError(`マクロの呼び出しが深すぎます（${callee.name}）`);
      const args = stmt.args.map((a) => substitute(a, scope, owner));
      const hasVararg = callee.params.some((p) => p.vararg);
      if (!hasVararg && args.length > callee.params.length) {
        throw new LayoutError(`${stmt.line} 行目の ${callee.name} の引数が多すぎます（${args.length} 個、受けるのは ${callee.params.length} 個）`);
      }
      const inner = new Map<string, string>();
      callee.params.forEach((p, i) => {
        let v = p.vararg ? args.slice(i).join(", ") : (args[i] ?? "");
        if (v.trim() === "" && p.defaultValue !== undefined) v = p.defaultValue;
        if (v.trim() === "" && p.required) {
          throw new LayoutError(`${stmt.line} 行目の ${callee.name} に必須の引数 ${p.name} がありません`);
        }
        inner.set(p.name, v);
      });
      current = run(callee.body, inner, callee.name, current, [...chain, callee.name.toLowerCase()]);
    }
    return current;
  };

  try {
    const states = run(macro.body, bindings, macro.name, [{ conditions: [], fields: [] }], [macro.name.toLowerCase()]);
    const variants: MacroVariant[] = states.map((s) => {
      const first = s.fields[0];
      return {
        conditions: s.conditions,
        fields: s.fields,
        size: s.fields.reduce((n, f) => n + f.size, 0),
        opcode: first && first.kind === "const" && first.size === 1 ? first.value : null,
      };
    });
    const opcodes: number[] = [];
    for (const v of variants) if (v.opcode !== null && !opcodes.includes(v.opcode)) opcodes.push(v.opcode);
    const sizes = variants.map((v) => v.size);
    const allOpcode = variants.every((v) => v.opcode !== null) && opcodes.length === 1 ? opcodes[0]! : null;
    const parts = composition(macro.body);
    const kind = parts.calls.length === 0 ? "direct" : !parts.data && parts.calls.length === 1 ? "alias" : "compound";
    const aliasOf = kind === "alias" ? (context.findMacro(parts.calls[0]!)?.name ?? null) : null;
    return {
      layout: {
        variants,
        opcode: allOpcode,
        opcodes,
        size: sizes.every((n) => n === sizes[0]) ? sizes[0]! : null,
        minSize: Math.min(...sizes),
        maxSize: Math.max(...sizes),
        composition: kind,
        aliasOf,
      },
    };
  } catch (e) {
    if (e instanceof LayoutError) return { error: e.message };
    throw e;
  }
}
