// .string（CFRU の scripts/string.py が読む文字列のファイル）の読み書き。
//
// 行の分け方は string.py に合わせる。
// - 行の区切りは LF・CRLF・CR（Python の文字のモードで読むのと同じ）。
// - `#include "` で始まる行、`#ifdef` / `#ifndef` / `#else` / `#endif` の行は指定（directive）。
// - 空白だけの行は空行、行頭が `//` の行はコメント。
// - 最初の `#org @ラベル` より前の行は、`MAX_LENGTH=` / `FILL_FF=` の設定か、それ以外（string.py は警告を出して飛ばす）。
// - `#org @ラベル` から次の `#org` までの、上のどれでもない行が本文。本文の 1 行が 1 つの文字列（終端 0xFF 付き）になる。
// - ただし、行の末尾がちょうど改行・改ページの制御記号（`\n` `\p` `\l` `\m`）で終わり、次の行も本文なら、次の行は
//   続きとして同じ文字列につながる（何も足さず、何も削らない。ZigzaguMap と一緒に直した string.py の規則。#221）。
//   制御記号のあとに空白があるときや、次の行が空行・コメント・指定・`#org` のときはつながらない。
// - つながらない 2 つ目の本文は、ラベルの付かない別の文字列として直後に置かれる。
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
  /** 本文の行で、前の本文の行の続き（前の行が制御記号で終わる）なら true。 */
  readonly continued: boolean;
}

/** `#org` 1 つ分。 */
export interface StringEntry {
  /** ラベル（`#org @` の後ろ。前後の空白を除く）。 */
  readonly label: string;
  /** `#org` の行の番号（0 から）。 */
  readonly headerLine: number;
  /** 本文の行の番号（0 から。続きの行も含む）。無ければ次のラベルと同じ文字列を指す。 */
  readonly bodyLines: readonly number[];
  /** ラベルが指す文字列（最初の文字列）の行の番号。1 行で書いたなら 1 つ、制御記号のあとで改行したなら複数。 */
  readonly textLines: readonly number[];
  /** この `#org` の文字列ごとの行の番号（最初がラベルの文字列、2 つ目からはラベルの付かない文字列）。 */
  readonly strings: readonly (readonly number[])[];
  /** この `#org` が受け持つ行の終わり（次の `#org` の行、なければ行の数。含まない）。 */
  readonly endLine: number;
  /** ラベルが指す文字列（最初の文字列。複数の行ならつないだもの）。本文が無ければ空文字。 */
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

/**
 * 行の末尾が改行・改ページの制御記号（`\n` `\p` `\l` `\m`）か。`\\n` のように前のバックスラッシュで
 * 打ち消されたものは数えない。後ろに空白があれば false。
 */
export function endsWithBreakControl(text: string): boolean {
  if (!/\\[nplm]$/.test(text)) return false;
  let slashes = 0;
  for (let i = text.length - 2; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

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
  const entries: {
    label: string;
    headerLine: number;
    bodyLines: number[];
    strings: number[][];
    conditions: readonly string[];
  }[] = [];
  let started = false;
  let maxLength = 0;
  let fillFF = false;
  const conditions: string[] = [];
  for (const [i, { text, eol }] of raw.entries()) {
    const kind = classify(text, started);
    const previous = lines[lines.length - 1];
    const continued = kind === "body" && previous?.kind === "body" && endsWithBreakControl(previous.text);
    lines.push({ text, eol, kind, continued });
    if (kind === "directive") {
      const c = conditionalOf(text);
      if (c?.type === "if") conditions.push(c.name);
      else if (c?.type === "else" && conditions.length > 0) {
        const last = conditions.pop()!;
        conditions.push(last.startsWith("!") ? last.slice(1) : `!${last}`);
      } else if (c?.type === "endif") conditions.pop();
    } else if (kind === "header") {
      started = true;
      entries.push({ label: pythonStrip(text).slice(6), headerLine: i, bodyLines: [], strings: [], conditions: [...conditions] });
    } else if (kind === "body") {
      const entry = entries[entries.length - 1]!;
      entry.bodyLines.push(i);
      if (continued && entry.strings.length > 0) entry.strings[entry.strings.length - 1]!.push(i);
      else entry.strings.push([i]);
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
      textLines: e.strings[0] ?? [],
      text: (e.strings[0] ?? []).map((n) => lines[n]!.text).join(""),
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

/**
 * 本文を .string の行に分ける。本文の中の改行の文字（LF / CRLF / CR）は、制御記号（`\n` `\p` `\l` `\m`）の
 * すぐ後ろにだけ書ける（そこで行を分けて書き、string.py がつなぎ直す）。分けた行がどれも本文として読まれるかも確かめる。
 * 書けなければ StringFileError。
 */
export function splitStringBodyLines(text: string): string[] {
  const parts = text.split(/\r\n|\n|\r/);
  for (const [i, part] of parts.entries()) {
    if (i < parts.length - 1 && !endsWithBreakControl(part)) {
      throw new StringFileError(`改行は制御記号（\\n・\\p・\\l・\\m）のすぐ後ろにだけ書けます: ${part.slice(-20)}`);
    }
    if (classify(part, true) !== "body") {
      throw new StringFileError(
        i === 0
          ? `本文として読まれない文字列です（空、// で始まる、#org などの指定と同じ形）: ${part}`
          : `改行の後ろの行が本文として読まれません（空、// で始まる、#org などの指定と同じ形）: ${part}`,
      );
    }
  }
  return parts;
}

/** 本文の行として読まれるか（空白だけ・`//`・`#org`・`#include` などの指定ではない）。 */
function isBodyText(text: string): boolean {
  return classify(text, true) === "body";
}

/**
 * 1 行の本文を、改行・改ページの制御記号のあとで行を分けた形（LF でつないだ文字列）にする。長い文を読みやすく書くため。
 * 分けた後ろの行が本文として読まれない（空白だけ、`//` や `#` の指定で始まる）ところでは分けない。
 * 本文にもう改行の文字があれば、そのまま返す。
 */
export function wrapStringBody(text: string): string {
  if (/[\r\n]/.test(text)) return text;
  const out: string[] = [];
  let line = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      line += text.slice(i, i + 2);
      i += 2;
      const rest = text.slice(i);
      // 次に分ける位置までを、分けた後ろの行として調べる
      const next = /\\[nplm]/.exec(rest);
      const segment = next ? rest.slice(0, next.index + 2) : rest;
      if (rest !== "" && endsWithBreakControl(line) && isBodyText(segment)) {
        out.push(line);
        line = "";
      }
    } else {
      line += text[i];
      i++;
    }
  }
  out.push(line);
  return out.join("\n");
}

function withLines(file: StringFile, lines: { text: string; eol: StringLineEnding }[]): StringFile {
  return build(file.bom, lines);
}

/**
 * ラベルの本文を差し替えた新しい形を返す（元の形は変えない）。
 *
 * 書き戻しの決まり:
 * - `\n` `\p` `\l` は文字のまま（バックスラッシュと英字）で書く。本文の中の改行の文字は、制御記号のすぐ後ろにだけ書け、
 *   そこで .string の行を分ける（`splitStringBodyLines`）。
 * - ラベルの文字列の行（1 行か、制御記号のあとで分けた複数の行）を新しい行に置き換える。いちばん後ろの行の改行は
 *   置き換える前の最後の行のもの、それより前の行はファイルでいちばん多い形。ほかの行（ラベルの付かない 2 つ目の文字列、
 *   コメント、空行）は変えない。
 * - 本文の行が無い（次のラベルと同じ文字列を指す）ときは、`#org` の直後に足す。次のラベルとの共有はなくなる。
 */
export function replaceStringBody(file: StringFile, label: string, text: string): StringFile {
  const entry = findStringEntry(file, label);
  if (!entry) throw new StringFileError(`ラベル ${label} の #org がありません`);
  const parts = splitStringBodyLines(text);
  const lines = file.lines.map((l) => ({ text: l.text, eol: l.eol }));
  const newline = stringFileNewline(file);
  const make = (lastEol: StringLineEnding) =>
    parts.map((p, i) => ({ text: p, eol: i < parts.length - 1 ? newline : lastEol }));
  const first = entry.textLines[0];
  if (first !== undefined) {
    const lastEol = lines[entry.textLines[entry.textLines.length - 1]!]!.eol;
    lines.splice(first, entry.textLines.length, ...make(lastEol));
  } else {
    const header = lines[entry.headerLine]!;
    if (header.eol === "") {
      lines[entry.headerLine] = { text: header.text, eol: newline };
      lines.splice(entry.headerLine + 1, 0, ...make(""));
    } else {
      lines.splice(entry.headerLine + 1, 0, ...make(header.eol));
    }
  }
  return withLines(file, lines);
}

/**
 * ラベルの `#org` を除いた新しい形を返す（イベントの削除 #220 で使う）。ラベルが無ければ StringFileError。
 *
 * - 除くのは、`#org` の行と、その `#org` の本文の行（続きの行と、ラベルの付かない 2 つ目からの文字列も）と、
 *   その後ろの空行。次の `#org` の前のコメント（次のまとまりの見出し）と、`#ifdef` などの指定の行は残す。
 * - 直前の行が ZigzaguMap の取り込みの印（`// ZigzaguMap:` のコメント）なら一緒に除く。
 * - 本文の無い前の `#org` がこのラベルの文字列を共有している（`#org` が続く書き方）ときと、このラベルに本文が無い
 *   （次のラベルの文字列を共有している）ときは、`#org` の行だけを除く。
 * - ファイルの最後のまとまりを除いたときは、残った最後の空行も除き、最後の改行の有無を元にそろえる。
 */
export function removeStringEntry(file: StringFile, label: string): StringFile {
  const index = file.entries.findIndex((e) => e.label === label);
  if (index < 0) throw new StringFileError(`ラベル ${label} の #org がありません`);
  const entry = file.entries[index]!;
  const previous = file.entries[index - 1];
  const shared = entry.bodyLines.length === 0 || (previous !== undefined && previous.bodyLines.length === 0);
  const remove = new Set<number>([entry.headerLine]);
  if (!shared) {
    let end = entry.endLine;
    while (end > entry.headerLine + 1 && file.lines[end - 1]!.kind !== "body" && file.lines[end - 1]!.kind !== "blank") end--;
    for (let n = entry.headerLine + 1; n < end; n++) {
      const kind = file.lines[n]!.kind;
      if (kind === "body" || kind === "blank" || kind === "comment") remove.add(n);
    }
    const mark = entry.headerLine - 1;
    if (mark >= 0 && file.lines[mark]!.kind === "comment" && /^\/\/\s*ZigzaguMap:/.test(file.lines[mark]!.text)) remove.add(mark);
  }
  const kept = file.lines.map((l) => ({ text: l.text, eol: l.eol })).filter((_, n) => !remove.has(n));
  const removedTail = remove.has(file.lines.length - 1);
  if (removedTail) {
    while (kept.length > 0 && pythonStrip(kept[kept.length - 1]!.text) === "") kept.pop();
    if (kept.length > 0) kept[kept.length - 1]!.eol = file.lines[file.lines.length - 1]!.eol;
  }
  return withLines(file, kept);
}

/**
 * ファイルの最後に `#org @ラベル` と本文を足した新しい形を返す。
 * 改行はファイルでいちばん多い形。最後の行が空行でなければ空行を 1 つはさむ。
 * 元のファイルが改行で終わっていなければ、足した本文も改行なしで終える。
 */
export function appendStringEntry(file: StringFile, label: string, text: string): StringFile {
  if (!LABEL_PATTERN.test(label)) throw new StringFileError(`ラベルに使えない名前です: ${label}`);
  if (findStringEntry(file, label)) throw new StringFileError(`ラベル ${label} はもうあります`);
  const parts = splitStringBodyLines(text);
  const newline = stringFileNewline(file);
  const lines = file.lines.map((l) => ({ text: l.text, eol: l.eol }));
  const last = lines[lines.length - 1];
  const finalNewline = last === undefined || last.eol !== "";
  if (last && last.eol === "") last.eol = newline;
  if (last && pythonStrip(last.text) !== "") lines.push({ text: "", eol: newline });
  lines.push({ text: `#org @${label}`, eol: newline });
  for (const [i, part] of parts.entries()) {
    lines.push({ text: part, eol: i < parts.length - 1 || finalNewline ? newline : "" });
  }
  return withLines(file, lines);
}
