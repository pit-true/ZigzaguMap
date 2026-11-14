// .string の本文（1 行の文字列）の字句と、ページ・行への分け方。
//
// 字句の区切りは scripts/string.py の ProcessString に合わせる。
// - `\` と次の 1 字: 制御（`\n` `\l` `\m` `\p`）か記号（`\$` `\"` など）。
// - `[名前]`: プレースホルダや色など（`[PLAYER]` `[BUFFER1]` `[RED]`）。`[XX]`（16 進 2 桁）は生のバイト。
// - `{名前}`: charmap.tbl の特別な並び（`{Lv}` など）。
// - `<XX YY>`: 生のバイト列。
// - それ以外は 1 字ずつ（サロゲートペアは 1 字）。
// 閉じていない `[` `{` `<` は、ふつうの字として扱う（string.py は `[` なら行の最後まで読み飛ばし、`{` `<` ならエラー）。

/** 字句の種類。 */
export type StringTokenKind =
  /** ふつうの字。 */
  | "char"
  /** 改行（`\n`、`\l`、`\m`）。 */
  | "lineBreak"
  /** 改ページ（`\p`）。 */
  | "pageBreak"
  /** `\` で始まる記号（`\$` など）。 */
  | "escape"
  /** `[名前]`。 */
  | "placeholder"
  /** `[XX]`（16 進 2 桁）。 */
  | "rawByte"
  /** `{名前}`。 */
  | "special"
  /** `<XX YY ...>`。 */
  | "rawBytes";

/** 本文の字句。 */
export interface StringToken {
  readonly kind: StringTokenKind;
  /** 本文に書かれたとおりの文字列（`[PLAYER]` なら括弧も含む）。 */
  readonly text: string;
  /** 本文の中の始まり（UTF-16 の位置）。 */
  readonly start: number;
  /** 本文の中の終わり（含まない）。 */
  readonly end: number;
}

/** 表示用の 1 行。 */
export interface StringTextLine {
  /** 行の文字列。制御の字句（`[PLAYER]` など）は書かれたまま。改行・改ページの `\n` `\p` は含まない。 */
  readonly text: string;
  /** 本文の中の始まり。 */
  readonly start: number;
  /** 本文の中の終わり（含まない。行の後ろの改行の字句は含まない）。 */
  readonly end: number;
  /** 行の字句（改行・改ページを除く）。 */
  readonly tokens: readonly StringToken[];
}

/** 表示用の 1 ページ。 */
export interface StringTextPage {
  readonly lines: readonly StringTextLine[];
}

const RAW_BYTE = /^\[[0-9A-Fa-f]{2}\]$/;

/** 本文を字句に分ける。 */
export function tokenizeStringText(text: string): StringToken[] {
  const tokens: StringToken[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    let end = i + 1;
    let kind: StringTokenKind = "char";
    if (c === "\\" && i + 1 < text.length) {
      const code = text.codePointAt(i + 1)!;
      end = i + 1 + (code > 0xffff ? 2 : 1);
      const next = text[i + 1];
      kind = next === "n" || next === "l" || next === "m" ? "lineBreak" : next === "p" ? "pageBreak" : "escape";
    } else if (c === "[" && text.indexOf("]", i + 1) >= 0) {
      end = text.indexOf("]", i + 1) + 1;
      kind = RAW_BYTE.test(text.slice(i, end)) ? "rawByte" : "placeholder";
    } else if (c === "{" && text.indexOf("}", i + 1) >= 0) {
      end = text.indexOf("}", i + 1) + 1;
      kind = "special";
    } else if (c === "<" && text.indexOf(">", i + 1) >= 0) {
      end = text.indexOf(">", i + 1) + 1;
      kind = "rawBytes";
    } else {
      const code = text.codePointAt(i)!;
      end = i + (code > 0xffff ? 2 : 1);
    }
    tokens.push({ kind, text: text.slice(i, end), start: i, end });
    i = end;
  }
  return tokens;
}

/**
 * 本文をページと行に分ける。`\p` で次のページ、`\n` `\l` `\m` で次の行。
 * `[PLAYER]`・`{...}`・`<FF 09>`・`[XX]` は書かれたまま行の文字列に残す。
 * 空の本文も 1 ページ 1 行（空の行）になる。
 */
export function splitStringPages(text: string): StringTextPage[] {
  const pages: StringTextPage[] = [];
  let lines: StringTextLine[] = [];
  let tokens: StringToken[] = [];
  let start = 0;
  const endLine = (end: number) => {
    lines.push({ text: text.slice(start, end), start, end, tokens });
    tokens = [];
  };
  for (const token of tokenizeStringText(text)) {
    if (token.kind === "lineBreak" || token.kind === "pageBreak") {
      endLine(token.start);
      if (token.kind === "pageBreak") {
        pages.push({ lines });
        lines = [];
      }
      start = token.end;
    } else {
      tokens.push(token);
    }
  }
  endLine(text.length);
  pages.push({ lines });
  return pages;
}

/** 表示用の文字列。ページの間は空行、行の間は改行（LF）。制御の字句は書かれたまま残す。 */
export function formatStringText(text: string): string {
  return splitStringPages(text)
    .map((page) => page.lines.map((line) => line.text).join("\n"))
    .join("\n\n");
}
