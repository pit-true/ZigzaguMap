// .string（CFRU の scripts/string.py が読む文字列のファイル）の読み書き。
//
// 行の分け方は string.py に合わせる。
// - 行の区切りは LF・CRLF・CR（Python の文字のモードで読むのと同じ）。
// - `#include "` で始まる行、`#ifdef` / `#ifndef` / `#else` / `#endif` の行は指定（directive）。
// - 空白だけの行は空行、行頭が `//` の行はコメント。
// - 最初の `#org @ラベル` より前の行は、`MAX_LENGTH=` / `FILL_FF=` の設定か、それ以外（string.py は警告を出して飛ばす）。
// - `#org @ラベル` から次の `#org` までの、上のどれでもない行が本文。本文の 1 行が 1 つの文字列（終端 0xFF 付き）になる。
//   続く行は連結しない。2 行目は、ラベルの付かない別の文字列として直後に置かれる。
// - 本文の無い `#org`（`#org` が続く）は、次のラベルと同じ文字列を指す。
//
// 読んだ行は改行の形（LF / CRLF / CR / 最後の改行なし）と BOM まで残し、`stringifyStringFile` で元の文字列に戻る。

/** 改行の形。最後の行で改行が無いときは空文字。 */
export type StringLineEnding = "\n" | "\r\n" | "\r" | "";

/** 行の種類。 */
export type StringLineKind =
  /** `#org @ラベル`。 */
  | "header"
  /** 本文（1 行が 1 つの文字列）。 */
  | "body"
  /** 空白だけの行。 */
  | "blank"
  /** 行頭が `//` の行。 */
  | "comment"
  /** `#include` / `#ifdef` / `#ifndef` / `#else` / `#endif`。 */
  | "directive"
  /** 最初の `#org` より前の `MAX_LENGTH=` / `FILL_FF=`。 */
  | "setting"
  /** 最初の `#org` より前の、どれでもない行（string.py は警告を出して飛ばす）。 */
  | "unknown";

/** .string の 1 行。 */
export interface StringLine {
  /** 改行を除いた行の文字列。 */
  readonly text: string;
  /** 行の後ろの改行。 */
  readonly eol: StringLineEnding;
  readonly kind: StringLineKind;
}

/** `#org` 1 つ分。 */
export interface StringEntry {
  /** ラベル（`#org @` の後ろ。前後の空白を除く）。 */
  readonly label: string;
  /** `#org` の行の番号（0 から）。 */
  readonly headerLine: number;
  /** 本文の行の番号（0 から）。ふつうは 1 つ。無ければ次のラベルと同じ文字列を指す。 */
  readonly bodyLines: readonly number[];
  /** この `#org` が受け持つ行の終わり（次の `#org` の行、なければ行の数。含まない）。 */
  readonly endLine: number;
  /** ラベルが指す文字列（最初の本文の行）。本文が無ければ空文字。 */
  readonly text: string;
  /** 囲んでいる `#ifdef` / `#ifndef` の条件（外側から。`#ifndef X` と `#else` の側は `!X`）。 */
  readonly conditions: readonly string[];
}

/** 最初の `#org` より前の設定。 */
export interface StringFileSettings {
  /** `MAX_LENGTH=` の値（無ければ 0。数でなければ string.py はエラー）。 */
  readonly maxLength: number;
  /** `FILL_FF=` の右側が空でないか（string.py は `bool(文字列)` なので `False` と書いても真）。 */
  readonly fillFF: boolean;
}

/** 読んだ .string。 */
export interface StringFile {
  /** 先頭に BOM があったか（string.py は BOM を読めないが、往復のために残す）。 */
  readonly bom: boolean;
  readonly lines: readonly StringLine[];
  readonly entries: readonly StringEntry[];
  readonly settings: StringFileSettings;
}

/** .string の扱いで起きた誤り（ラベルが無い、本文に書けない文字列など）。 */
export class StringFileError extends Error {
  override readonly name = "StringFileError";
}

/** Python の str.strip() が除く空白（全角の空白も含む。BOM は含まない）。 */
const PY_SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "g");

/** Python の str.strip() と同じ空白の除き方。 */
export function pythonStrip(text: string): string {
  return text.replace(PY_STRIP, "");
}

/** アセンブラのラベルに使える名前。 */
const LABEL_PATTERN = /^[A-Za-z_.][A-Za-z0-9_.]*$/;

function isHeader(line: string): boolean {
  return line.slice(0, 6).toUpperCase() === "#ORG @" && line.length > 6;
}

/** 条件の指定なら、その種類。string.py の TryProcessConditionalCompilation と同じ判定。 */
function conditionalOf(line: string): { type: "if"; name: string } | { type: "else" } | { type: "endif" } | null {
  const stripped = pythonStrip(line);
  const upper = stripped.toUpperCase();
  const words = stripped.split(/\s+/).filter((w) => w !== "");
  if ((upper.startsWith("#IFDEF ") || upper.startsWith("#IFNDEF ")) && words.length > 1) {
    return { type: "if", name: (upper.startsWith("#IFNDEF ") ? "!" : "") + words[1]! };
  }
  if (upper === "#ELSE") return { type: "else" };
  if (upper === "#ENDIF") return { type: "endif" };
  return null;
}

/** 1 行の種類。`started` は最初の `#org` を読んだあとか。 */
function classify(text: string, started: boolean): StringLineKind {
  if (text.startsWith('#include "')) return "directive";
  if (conditionalOf(text)) return "directive";
  const stripped = pythonStrip(text);
  if (stripped === "") return "blank";
  if (text.startsWith("//")) return "comment";
  if (!started) {
    if (isHeader(stripped)) return "header";
    if ((stripped.includes("MAX_LENGTH") || stripped.includes("FILL_FF")) && stripped.includes("=")) return "setting";
    return "unknown";
  }
  return isHeader(text) ? "header" : "body";
}

function splitLines(source: string): { text: string; eol: StringLineEnding }[] {
  const lines: { text: string; eol: StringLineEnding }[] = [];
  const re = /\r\n|\n|\r/g;
  let start = 0;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    lines.push({ text: source.slice(start, m.index), eol: m[0] as StringLineEnding });
    start = m.index + m[0].length;
  }
  if (start < source.length) lines.push({ text: source.slice(start), eol: "" });
  return lines;
}

function build(bom: boolean, raw: readonly { text: string; eol: StringLineEnding }[]): StringFile {
  const lines: StringLine[] = [];
  const entries: { label: string; headerLine: number; bodyLines: number[]; conditions: readonly string[] }[] = [];
  let started = false;
  let maxLength = 0;
  let fillFF = false;
  const conditions: string[] = [];
  for (const [i, { text, eol }] of raw.entries()) {
    const kind = classify(text, started);
    lines.push({ text, eol, kind });
    if (kind === "directive") {
      const c = conditionalOf(text);
      if (c?.type === "if") conditions.push(c.name);
      else if (c?.type === "else" && conditions.length > 0) {
        const last = conditions.pop()!;
        conditions.push(last.startsWith("!") ? last.slice(1) : `!${last}`);
      } else if (c?.type === "endif") conditions.pop();
    } else if (kind === "header") {
      started = true;
      entries.push({ label: pythonStrip(text).slice(6), headerLine: i, bodyLines: [], conditions: [...conditions] });
    } else if (kind === "body") {
      entries[entries.length - 1]!.bodyLines.push(i);
    } else if (kind === "setting") {
      const value = pythonStrip(text).split("=")[1] ?? "";
      if (pythonStrip(text).includes("MAX_LENGTH")) {
        const n = Number.parseInt(pythonStrip(value), 10);
        if (Number.isFinite(n)) maxLength = n;
      } else {
        fillFF = value !== "";
      }
    }
  }
  return {
    bom,
    lines,
    entries: entries.map((e, k) => ({
      ...e,
      endLine: entries[k + 1]?.headerLine ?? lines.length,
      text: e.bodyLines.length > 0 ? lines[e.bodyLines[0]!]!.text : "",
    })),
    settings: { maxLength, fillFF },
  };
}

/** .string の中身（文字列）を読む。読めない行は無く、どんな文字列でも元に戻せる形で読む。 */
export function parseStringFile(source: string): StringFile {
  const bom = source.startsWith("﻿");
  return build(bom, splitLines(bom ? source.slice(1) : source));
}

/** 読んだ形を文字列に戻す。`parseStringFile` の結果なら元の文字列と同じになる。 */
export function stringifyStringFile(file: StringFile): string {
  let out = file.bom ? "﻿" : "";
  for (const line of file.lines) out += line.text + line.eol;
  return out;
}

/** ファイルでいちばん多い改行の形（改行が 1 つも無ければ LF）。 */
export function stringFileNewline(file: StringFile): "\n" | "\r\n" | "\r" {
  const count = { "\n": 0, "\r\n": 0, "\r": 0 };
  for (const line of file.lines) if (line.eol !== "") count[line.eol]++;
  if (count["\r\n"] > count["\n"] && count["\r\n"] >= count["\r"]) return "\r\n";
  if (count["\r"] > count["\n"]) return "\r";
  return "\n";
}

/**
 * 各行の先頭の位置（`stringifyStringFile` の文字列の中の、UTF-16 の位置。BOM を含めて数える）。
 * 長さは行の数 + 1 で、最後はファイルの終わり。
 */
export function stringLineOffsets(file: StringFile): number[] {
  const offsets = [file.bom ? 1 : 0];
  for (const line of file.lines) offsets.push(offsets[offsets.length - 1]! + line.text.length + line.eol.length);
  return offsets;
}

/** ラベルの `#org`。無ければ null。 */
export function findStringEntry(file: StringFile, label: string): StringEntry | null {
  return file.entries.find((e) => e.label === label) ?? null;
}

/**
 * ラベルが指す文字列。本文の無い `#org` は、本文のある次の `#org` の文字列（string.py が同じ場所にラベルを並べる）。
 * ラベルが無ければ null。
 */
export function resolveStringText(file: StringFile, label: string): string | null {
  const index = file.entries.findIndex((e) => e.label === label);
  if (index < 0) return null;
  for (let i = index; i < file.entries.length; i++) {
    if (file.entries[i]!.bodyLines.length > 0) return file.entries[i]!.text;
  }
  return "";
}

/** 本文の 1 行として書けるか確かめる。書けなければ StringFileError。 */
function checkBodyText(text: string): void {
  if (/[\r\n]/.test(text)) {
    throw new StringFileError("本文に改行の文字は書けません（改行は \\n、改ページは \\p と書きます）");
  }
  if (classify(text, true) !== "body") {
    throw new StringFileError(`本文として読まれない文字列です（空、// で始まる、#org などの指定と同じ形）: ${text}`);
  }
}

function withLines(file: StringFile, lines: { text: string; eol: StringLineEnding }[]): StringFile {
  return build(file.bom, lines);
}

/**
 * ラベルの本文を差し替えた新しい形を返す（元の形は変えない）。
 *
 * 書き戻しの決まり:
 * - 本文は 1 行で書く。`\n` `\p` `\l` は文字のまま（バックスラッシュと英字）で書き、改行の文字は使えない。
 * - 本文の行があれば、最初の本文の行の文字列だけを置き換える。改行の形、2 行目以降の本文、コメント、空行は変えない。
 * - 本文の行が無い（次のラベルと同じ文字列を指す）ときは、`#org` の直後に 1 行足す。次のラベルとの共有はなくなる。
 */
export function replaceStringBody(file: StringFile, label: string, text: string): StringFile {
  const entry = findStringEntry(file, label);
  if (!entry) throw new StringFileError(`ラベル ${label} の #org がありません`);
  checkBodyText(text);
  const lines = file.lines.map((l) => ({ text: l.text, eol: l.eol }));
  const first = entry.bodyLines[0];
  if (first !== undefined) {
    lines[first] = { text, eol: lines[first]!.eol };
  } else {
    const header = lines[entry.headerLine]!;
    const newline = stringFileNewline(file);
    if (header.eol === "") {
      lines[entry.headerLine] = { text: header.text, eol: newline };
      lines.splice(entry.headerLine + 1, 0, { text, eol: "" });
    } else {
      lines.splice(entry.headerLine + 1, 0, { text, eol: header.eol });
    }
  }
  return withLines(file, lines);
}

/**
 * ファイルの最後に `#org @ラベル` と本文を足した新しい形を返す。
 * 改行はファイルでいちばん多い形。最後の行が空行でなければ空行を 1 つはさむ。
 * 元のファイルが改行で終わっていなければ、足した本文も改行なしで終える。
 */
export function appendStringEntry(file: StringFile, label: string, text: string): StringFile {
  if (!LABEL_PATTERN.test(label)) throw new StringFileError(`ラベルに使えない名前です: ${label}`);
  if (findStringEntry(file, label)) throw new StringFileError(`ラベル ${label} はもうあります`);
  checkBodyText(text);
  const newline = stringFileNewline(file);
  const lines = file.lines.map((l) => ({ text: l.text, eol: l.eol }));
  const last = lines[lines.length - 1];
  const finalNewline = last === undefined || last.eol !== "";
  if (last && last.eol === "") last.eol = newline;
  if (last && pythonStrip(last.text) !== "") lines.push({ text: "", eol: newline });
  lines.push({ text: `#org @${label}`, eol: newline });
  lines.push({ text, eol: finalNewline ? newline : "" });
  return withLines(file, lines);
}
