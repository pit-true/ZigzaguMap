import type { ProjectFs } from "../../project/ProjectFs.js";
import { type EventScriptKind, type EventScriptTarget, eventScriptTargetOf, parseEventScriptKind } from "./eventScriptKinds.js";

/** プロジェクトフォルダの eventscripts のパス。 */
export const EVENT_SCRIPTS_PATH = "eventscripts";

/**
 * 行の種類。insert.py の読み方と同じ順で決める。
 * - `include`: 行頭の `#include "パス"`（字下げしたものはコメント）。
 * - `conditional`: `#ifdef` / `#ifndef` / `#else` / `#endif`（大文字小文字を区別しない）。
 * - `comment`: その他の `#` で始まる行（`##` の見出し、`#define` も含む。insert.py は eventscripts 自身の `#define` を読まない）。
 * - `blank`: 空白だけの行。
 * - `entry`: `種別 バンク マップ [番号] シンボル` の行。
 * - `unknown`: どれにも当たらない行（トークンの数が違う、種別が無い、`npc` などで番号が無いなど）。insert.py は読み飛ばすか警告を出す。
 */
export type EventScriptsLineType = "include" | "conditional" | "comment" | "blank" | "entry" | "unknown";

/** 1 行。`text` は改行を除いた本文、`eol` はその行の改行（`"\n"` / `"\r\n"` / `"\r"`、最後の行で改行が無ければ `""`）。 */
export interface EventScriptsLine {
  /** 行番号（1 から）。 */
  readonly line: number;
  readonly text: string;
  readonly eol: string;
  readonly type: EventScriptsLineType;
}

/** `#ifdef 名前`（defined が true）か `#ifndef 名前`（false）。`#else` の後ろは向きが逆になる。 */
export interface EventScriptCondition {
  readonly name: string;
  readonly defined: boolean;
}

/** eventscripts の 1 件（`entry` の行）。編集すると行番号が変わるので、編集のあとは `entries()` で取り直す。 */
export interface EventScriptEntry {
  /** 行番号（1 から）。 */
  readonly line: number;
  /** 行の本文（改行を除く）。 */
  readonly text: string;
  /** 種別（小文字にしたもの）。 */
  readonly kind: EventScriptKind;
  readonly bank: number;
  readonly map: number;
  /** イベントの番号（並びの中の位置、0 から）。`map` は省略でき、書いてあっても insert.py は使わない。 */
  readonly index: number | null;
  /** 書いてあるシンボル（`trainer` / `item` は頭の文字列を付ける前のもの。ラベル名は `eventScriptLabel`）。 */
  readonly symbol: string;
  /** 囲んでいる `#ifdef` / `#ifndef`（外側から順）。空なら条件なし。 */
  readonly conditions: readonly EventScriptCondition[];
}

/** 足す行の中身。 */
export interface EventScriptEntrySpec {
  readonly kind: EventScriptKind;
  readonly bank: number;
  readonly map: number;
  /** `map` 以外では必須。 */
  readonly index?: number | null;
  readonly symbol: string;
}

/** 番号を付け直した結果。 */
export interface EventScriptsRemapResult {
  /** 消した行（消す前の内容）。 */
  readonly removed: readonly EventScriptEntry[];
  /** 番号を変えた行（変えた後の内容）。 */
  readonly changed: readonly EventScriptEntry[];
}

/** eventscripts の編集で、渡した項目や値が使えないときの Error。 */
export class EventScriptsEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventScriptsEditError";
  }
}

/** Python の str.split() / strip() が空白とみなす文字（JS の \s とは BOM などが違う）。 */
const PY_SPACE = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const TOKEN = new RegExp(`[^${PY_SPACE}]+`, "g");
const TRIM = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");
const DIGITS = /^[0-9]+$/;

interface RawLine {
  text: string;
  eol: string;
}

interface Token {
  readonly text: string;
  readonly start: number;
}

/**
 * eventscripts の読み書き。行（コメント・空行・`#include` などの指示・読めない行）と改行をすべて持ち、
 * `stringify()` は読んだ文字列を 1 バイトも変えずに返す。編集は、足す・変える・消す行だけを変える。
 *
 * 番号の付け直し（`removeEvent` / `swapEvents` / `moveEvent` / `remapIndexes`）は、`#ifdef` の中の行も
 * 同じように付け直す（どの条件でビルドしても、番号は同じイベントの並びを指すため）。
 */
export class EventScriptsFile {
  #lines: RawLine[];
  #cache: { lines: EventScriptsLine[]; entries: EventScriptEntry[] } | null = null;

  private constructor(lines: RawLine[]) {
    this.#lines = lines;
  }

  /** 文字列を読む。改行は `\r\n` / `\n` / `\r` のどれでもよく、行ごとに覚える。 */
  static parse(text: string): EventScriptsFile {
    const lines: RawLine[] = [];
    const re = /\r\n|\n|\r/g;
    let start = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      lines.push({ text: text.slice(start, m.index), eol: m[0] });
      start = m.index + m[0].length;
    }
    if (start < text.length) lines.push({ text: text.slice(start), eol: "" });
    return new EventScriptsFile(lines);
  }

  /** 書き戻す。 */
  stringify(): string {
    let out = "";
    for (const l of this.#lines) out += l.text + l.eol;
    return out;
  }

  /** 足す行に使う改行（ファイルで最初に出てくる改行。無ければ `\n`）。 */
  get newline(): string {
    return this.#lines.find((l) => l.eol !== "")?.eol ?? "\n";
  }

  /** すべての行。 */
  lines(): readonly EventScriptsLine[] {
    return this.#analyze().lines;
  }

  /** すべての項目（ファイルの順）。 */
  entries(): readonly EventScriptEntry[] {
    return this.#analyze().entries;
  }

  /** `#include "パス"` のパス（ファイルの順）。 */
  includes(): string[] {
    return this.#lines.filter((l) => l.text.startsWith('#include "')).map((l) => (l.text.split('"')[1] ?? "").replace(TRIM, ""));
  }

  /** バンク・マップの項目。`target` と `index` を渡すと、そのイベントの項目だけ（`#ifdef` で複数あることもある）。 */
  entriesFor(bank: number, map: number, target?: EventScriptTarget, index?: number): EventScriptEntry[] {
    return this.entries().filter(
      (e) =>
        e.bank === bank &&
        e.map === map &&
        (target === undefined || eventScriptTargetOf(e.kind) === target) &&
        (index === undefined || e.index === index),
    );
  }

  /**
   * 行を 1 つ足す（`種別 バンク マップ [番号] シンボル` を空白 1 つで区切り、種別は小文字）。
   * 置き場所は、同じバンク・マップの条件なし（`#ifdef` の外）の項目のうち最後のものの次の行。無ければファイルの末尾
   * （末尾が開いたままの `#ifdef` の中でも末尾に足す）。最後の行に改行が無ければ、その行に改行を付けてから足し、
   * 足した行は改行なしで終える。
   */
  add(spec: EventScriptEntrySpec): EventScriptEntry {
    validateSpec(spec);
    const fields = [spec.kind, String(spec.bank), String(spec.map)];
    if (spec.index !== undefined && spec.index !== null) fields.push(String(spec.index));
    fields.push(spec.symbol);
    const text = fields.join(" ");

    const sameMap = this.entries().filter((e) => e.bank === spec.bank && e.map === spec.map && e.conditions.length === 0);
    const after = sameMap.length > 0 ? sameMap[sameMap.length - 1]!.line - 1 : this.#lines.length - 1;
    const newline = this.newline;
    const prev = this.#lines[after];
    let eol = newline;
    if (prev && prev.eol === "") {
      prev.eol = newline;
      eol = "";
    }
    this.#lines.splice(after + 1, 0, { text, eol });
    this.#cache = null;
    return this.#entryAt(after + 2);
  }

  /** 項目のシンボルを変える（シンボルの部分だけを書き換え、他の空白などは残す）。 */
  setSymbol(entry: EventScriptEntry, symbol: string): EventScriptEntry {
    validateSymbol(symbol);
    const raw = this.#check(entry);
    const tokens = tokenize(raw.text);
    const last = tokens[tokens.length - 1]!;
    raw.text = raw.text.slice(0, last.start) + symbol + raw.text.slice(last.start + last.text.length);
    this.#cache = null;
    return this.#entryAt(entry.line);
  }

  /** 項目の行を消す（番号は付け直さない。イベントごと消すときは `removeEvent`）。 */
  remove(entry: EventScriptEntry): void {
    this.#check(entry);
    this.#lines.splice(entry.line - 1, 1);
    this.#cache = null;
  }

  /**
   * バンク・マップの `target` の並びの番号を付け直す。`mapping(古い番号)` が新しい番号を返す。null ならその行を消す。
   * `person` は `npc` / `trainer` / `item` をまとめて扱う。`#ifdef` の中の行も同じように付け直す。
   * 番号の書き方は元の行に合わせる（`03` のように 0 で桁をそろえていれば同じ桁数にする）。
   */
  remapIndexes(bank: number, map: number, target: Exclude<EventScriptTarget, "map">, mapping: (index: number) => number | null): EventScriptsRemapResult {
    const targets = this.entriesFor(bank, map, target).filter((e) => e.index !== null);
    const plan = targets.map((e) => {
      const next = mapping(e.index!);
      if (next !== null && !isIndex(next)) throw new EventScriptsEditError(`番号は 0 以上の整数でなければなりません: ${next}`);
      return { entry: e, next };
    });
    const removed: EventScriptEntry[] = [];
    const changedLines: number[] = [];
    for (const { entry, next } of plan) {
      const raw = this.#lines[entry.line - 1]!;
      if (next === null) {
        removed.push(entry);
        continue;
      }
      if (next === entry.index) continue;
      const indexToken = tokenize(raw.text)[3]!;
      raw.text = raw.text.slice(0, indexToken.start) + formatIndex(next, indexToken.text) + raw.text.slice(indexToken.start + indexToken.text.length);
      changedLines.push(entry.line);
    }
    // 後ろの行から消し、残る行の新しい行番号を数える。
    const removedLines = removed.map((e) => e.line);
    for (const line of [...removedLines].sort((a, b) => b - a)) this.#lines.splice(line - 1, 1);
    this.#cache = null;
    const changed = changedLines.map((line) => this.#entryAt(line - removedLines.filter((r) => r < line).length));
    return { removed, changed };
  }

  /** イベントを 1 つ消したときの付け直し: その番号の行を消し、後ろの番号を 1 つずつ減らす。 */
  removeEvent(bank: number, map: number, target: Exclude<EventScriptTarget, "map">, index: number): EventScriptsRemapResult {
    requireIndex(index);
    return this.remapIndexes(bank, map, target, (i) => (i === index ? null : i > index ? i - 1 : i));
  }

  /** 2 つのイベントの順を入れ替えたときの付け直し。 */
  swapEvents(bank: number, map: number, target: Exclude<EventScriptTarget, "map">, a: number, b: number): EventScriptsRemapResult {
    requireIndex(a);
    requireIndex(b);
    return this.remapIndexes(bank, map, target, (i) => (i === a ? b : i === b ? a : i));
  }

  /** イベントを `from` から `to` へ動かした（間のイベントが 1 つずつずれた）ときの付け直し。 */
  moveEvent(bank: number, map: number, target: Exclude<EventScriptTarget, "map">, from: number, to: number): EventScriptsRemapResult {
    requireIndex(from);
    requireIndex(to);
    return this.remapIndexes(bank, map, target, (i) => {
      if (i === from) return to;
      if (from < to && i > from && i <= to) return i - 1;
      if (to < from && i >= to && i < from) return i + 1;
      return i;
    });
  }

  #check(entry: EventScriptEntry): RawLine {
    const raw = this.#lines[entry.line - 1];
    if (!raw || raw.text !== entry.text || this.#analyze().lines[entry.line - 1]!.type !== "entry") {
      throw new EventScriptsEditError(`項目が古くなっています（${entry.line} 行目）。entries() で取り直してください`);
    }
    return raw;
  }

  #entryAt(line: number): EventScriptEntry {
    const entry = this.entries().find((e) => e.line === line);
    if (!entry) throw new EventScriptsEditError(`${line} 行目は項目ではありません`);
    return entry;
  }

  #analyze() {
    if (this.#cache) return this.#cache;
    const lines: EventScriptsLine[] = [];
    const entries: EventScriptEntry[] = [];
    let stack: EventScriptCondition[] = [];
    this.#lines.forEach((raw, i) => {
      const line = i + 1;
      const result = classify(raw.text, stack);
      stack = result.stack;
      lines.push({ line, text: raw.text, eol: raw.eol, type: result.type });
      if (result.entry) entries.push({ line, text: raw.text, ...result.entry, conditions: stack });
    });
    this.#cache = { lines, entries };
    return this.#cache;
  }
}

/** 1 行を insert.py と同じ順で見分ける。`stack` は外側から順の条件（書き換えずに新しい配列を返す）。 */
function classify(
  text: string,
  stack: EventScriptCondition[],
): { type: EventScriptsLineType; stack: EventScriptCondition[]; entry?: Omit<EventScriptEntry, "line" | "text" | "conditions"> } {
  if (text.startsWith('#include "')) return { type: "include", stack };
  const stripped = text.replace(TRIM, "");
  const upper = stripped.toUpperCase();
  const words = tokenize(stripped);
  if ((upper.startsWith("#IFDEF ") || upper.startsWith("#IFNDEF ")) && words.length > 1) {
    return { type: "conditional", stack: [...stack, { name: words[1]!.text, defined: upper.startsWith("#IFDEF ") }] };
  }
  if (upper === "#ELSE") {
    const top = stack[stack.length - 1];
    return { type: "conditional", stack: top ? [...stack.slice(0, -1), { name: top.name, defined: !top.defined }] : stack };
  }
  if (upper === "#ENDIF") return { type: "conditional", stack: stack.slice(0, -1) };
  if (stripped.startsWith("#")) return { type: "comment", stack };
  if (stripped === "") return { type: "blank", stack };

  if (words.length !== 4 && words.length !== 5) return { type: "unknown", stack };
  const kind = parseEventScriptKind(words[0]!.text);
  const bank = words[1]!.text;
  const map = words[2]!.text;
  const index = words.length === 5 ? words[3]!.text : null;
  if (!kind || !DIGITS.test(bank) || !DIGITS.test(map) || (index !== null && !DIGITS.test(index))) return { type: "unknown", stack };
  if (kind !== "map" && index === null) return { type: "unknown", stack };
  return {
    type: "entry",
    stack,
    entry: { kind, bank: Number(bank), map: Number(map), index: index === null ? null : Number(index), symbol: words[words.length - 1]!.text },
  };
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((m) => ({ text: m[0], start: m.index }));
}

function formatIndex(value: number, old: string): string {
  const text = String(value);
  return old.length > 1 && old.startsWith("0") ? text.padStart(old.length, "0") : text;
}

function isIndex(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

function requireIndex(n: number): void {
  if (!isIndex(n)) throw new EventScriptsEditError(`番号は 0 以上の整数でなければなりません: ${n}`);
}

function validateSymbol(symbol: string): void {
  if (symbol === "" || tokenize(symbol).length !== 1 || tokenize(symbol)[0]!.text !== symbol || symbol.startsWith("#")) {
    throw new EventScriptsEditError(`シンボルに使えない文字列です: "${symbol}"`);
  }
}

function validateSpec(spec: EventScriptEntrySpec): void {
  if (parseEventScriptKind(spec.kind) !== spec.kind) throw new EventScriptsEditError(`種別が不正です: ${spec.kind}`);
  for (const [name, v] of [["バンク", spec.bank], ["マップ", spec.map]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new EventScriptsEditError(`${name}は 0〜255 の整数でなければなりません: ${v}`);
  }
  const index = spec.index ?? null;
  if (index === null && spec.kind !== "map") throw new EventScriptsEditError(`${spec.kind} には番号が要ります`);
  if (index !== null) requireIndex(index);
  validateSymbol(spec.symbol);
}

/**
 * `#include` 先のファイル（`src/config.h` など）から `#define` を読む（insert.py の TryProcessFileInclusion と同じ）。
 * 行頭の `#define 名前 [値]` だけを読み、値が無いか `//` `/*` で始まるなら true。
 */
export function parseEventScriptDefines(text: string, into: Map<string, string | true> = new Map()): Map<string, string | true> {
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (!line.startsWith("#define ")) continue;
    const words = tokenize(line).map((t) => t.text);
    const title = words[1];
    if (title === undefined) continue;
    const value = words[2];
    into.set(title, value === undefined || value.startsWith("//") || value.startsWith("/*") ? true : value);
  }
  return into;
}

/** `defines` でビルドしたとき、項目が `#ifdef` / `#ifndef` で飛ばされずに使われるか。 */
export function isEventScriptEntryActive(entry: EventScriptEntry, defines: ReadonlyMap<string, string | true>): boolean {
  return entry.conditions.every((c) => defines.has(c.name) === c.defined);
}

/** プロジェクトの eventscripts を読む。無ければ空のファイルとして扱う。 */
export async function loadEventScripts(fs: ProjectFs): Promise<EventScriptsFile> {
  if (!(await fs.exists(EVENT_SCRIPTS_PATH))) return EventScriptsFile.parse("");
  return EventScriptsFile.parse(await fs.readText(EVENT_SCRIPTS_PATH));
}

/** プロジェクトの eventscripts を書く。 */
export async function saveEventScripts(fs: ProjectFs, file: EventScriptsFile): Promise<void> {
  await fs.writeText(EVENT_SCRIPTS_PATH, file.stringify());
}
