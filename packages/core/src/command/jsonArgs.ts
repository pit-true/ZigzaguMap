/** JSON の引数を読む小さな関数群（形が違えば TypeError。値の範囲は各コマンドが EditError で確かめる）。 */

import type { JsonObject, JsonValue } from "./Command.js";

/** 引数のオブジェクト。 */
export type Args = Record<string, unknown>;

/** 整数。無い・整数でなければ TypeError。 */
export function argInt(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new TypeError(`引数 ${key} は整数でなければなりません`);
  return value;
}

/** 省略できる整数。 */
export function argOptInt(args: Args, key: string): number | undefined {
  return args[key] === undefined ? undefined : argInt(args, key);
}

/** 真偽値。 */
export function argBool(args: Args, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") throw new TypeError(`引数 ${key} は true か false でなければなりません`);
  return value;
}

/** 省略できる真偽値。 */
export function argOptBool(args: Args, key: string): boolean | undefined {
  return args[key] === undefined ? undefined : argBool(args, key);
}

/** 文字列。 */
export function argString(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new TypeError(`引数 ${key} は文字列でなければなりません`);
  return value;
}

/** 省略できる文字列。 */
export function argOptString(args: Args, key: string): string | undefined {
  return args[key] === undefined ? undefined : argString(args, key);
}

/** 決まった値のどれか。 */
export function argEnum<T extends string>(args: Args, key: string, values: readonly T[]): T {
  const value = argString(args, key);
  if (!values.includes(value as T)) throw new TypeError(`引数 ${key} は ${values.join(" / ")} のどれかでなければなりません`);
  return value as T;
}

/** 整数の配列。 */
export function argIntArray(args: Args, key: string): number[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "number" || !Number.isInteger(v))) {
    throw new TypeError(`引数 ${key} は整数の配列でなければなりません`);
  }
  return value as number[];
}

/** 真偽値の配列。 */
export function argBoolArray(args: Args, key: string): boolean[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "boolean")) {
    throw new TypeError(`引数 ${key} は true / false の配列でなければなりません`);
  }
  return value as boolean[];
}

/** 値が整数か真偽値のオブジェクト（項目名 → 値）。 */
export function argFieldMap(args: Args, key: string): Record<string, number | boolean> {
  const value = args[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`引数 ${key} はオブジェクトでなければなりません`);
  }
  for (const [k, v] of Object.entries(value)) {
    if (!(typeof v === "boolean" || (typeof v === "number" && Number.isInteger(v)))) {
      throw new TypeError(`引数 ${key}.${k} は整数か true / false でなければなりません`);
    }
  }
  return { ...(value as Record<string, number | boolean>) };
}

/** バンクとマップの番号。 */
export function argMapId(args: Args): { bank: number; map: number } {
  return { bank: argInt(args, "bank"), map: argInt(args, "map") };
}

/** undefined の項目を除いて JSON にできる形にする。 */
export function compactArgs<T extends Record<string, JsonValue | undefined>>(args: T): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined) out[k] = v;
  return out;
}
