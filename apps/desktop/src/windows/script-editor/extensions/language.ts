import { StreamLanguage, type StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { EditorExtensionFactory } from "./context";

/**
 * `.s` と `.string` の言語（行ごとの字句）。字句の種類は @lezer/highlight の tags に結び、色はテーマ（themes.ts）で付ける。
 * 命令名と引数の種類（命令表と索引が要るもの）は highlight.ts が見えている行にだけ印を付ける。
 *
 * `.s`: コメント（`@`、行頭の `#`、`/* *\/`）、ラベル定義、ディレクティブ、数、文字列、マクロの引数参照（`\引数`）。
 * `.string`: `#org @ラベル`、`//` のコメント、`#include` などの指定、本文の制御（`\n` `\p` `\l`、`[PLAYER]`、`{...}`、`<FF 09>`）。
 * コメントの切り替え（Ctrl+/）は、`.s` は `@`、`.string` は `//`。
 */

interface AsmState {
  /** `/* *\/` の中。 */
  block: boolean;
  /** 行の中で、ラベル定義を読める位置（まだ命令もディレクティブも読んでいない）。 */
  head: boolean;
}

const NAME = /^[A-Za-z_.$][A-Za-z0-9_.$]*/;
const NUMBER = /^[-+~]?(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|[0-9]+)\b/;

const asmLanguage = StreamLanguage.define<AsmState>({
  name: "gen3asm",
  startState: () => ({ block: false, head: true }),
  copyState: (s) => ({ ...s }),
  token(stream: StringStream, state: AsmState): string | null {
    if (stream.sol()) state.head = true;
    if (state.block) {
      if (stream.skipTo("*/")) {
        stream.pos += 2;
        state.block = false;
      } else stream.skipToEnd();
      return "blockComment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("/*")) {
      if (stream.skipTo("*/")) stream.pos += 2;
      else {
        stream.skipToEnd();
        state.block = true;
      }
      return "blockComment";
    }
    const ch = stream.peek()!;
    if (ch === "@") {
      stream.skipToEnd();
      return "lineComment";
    }
    if (ch === "#" && state.head && stream.string.slice(0, stream.pos).trim() === "") {
      stream.skipToEnd();
      return "lineComment";
    }
    if (ch === '"') {
      stream.next();
      let escaped = false;
      for (let c = stream.next(); c !== undefined; c = stream.next()) {
        if (c === '"' && !escaped) break;
        escaped = !escaped && c === "\\";
      }
      return "string";
    }
    if (ch === "\\" && stream.match(/^\\[A-Za-z_]\w*/)) return "macroName";
    if (state.head) {
      const m = stream.match(NAME, false) as RegExpMatchArray | null;
      if (m && stream.string.charAt(stream.pos + m[0].length) === ":") {
        stream.pos += m[0].length;
        return "labelName";
      }
      if (/^[0-9]+:/.test(stream.string.slice(stream.pos))) {
        stream.match(/^[0-9]+/);
        return "labelName";
      }
    }
    if (ch === ":" && state.head) {
      stream.next();
      return "punctuation";
    }
    if (ch === "." && stream.match(NAME)) {
      state.head = false;
      return "keyword";
    }
    if (stream.match(NUMBER)) {
      state.head = false;
      return "number";
    }
    if (stream.match(NAME)) {
      state.head = false;
      return null;
    }
    stream.next();
    state.head = false;
    return ch === "," ? "punctuation" : null;
  },
  languageData: { commentTokens: { line: "@", block: { open: "/*", close: "*/" } } },
  tokenTable: { macroName: tags.macroName, labelName: tags.labelName },
});

const stringLanguage = StreamLanguage.define<{ header: boolean }>({
  name: "cfrustring",
  startState: () => ({ header: false }),
  copyState: (s) => ({ ...s }),
  token(stream: StringStream, state: { header: boolean }): string | null {
    if (stream.sol()) {
      state.header = false;
      if (stream.match("//")) {
        stream.skipToEnd();
        return "lineComment";
      }
      if (stream.match(/^#org\s*/i)) {
        state.header = true;
        return "keyword";
      }
      if (stream.match(/^#(include|ifdef|ifndef|else|endif)\b.*/i) || stream.match(/^\s*(MAX_LENGTH|FILL_FF)\s*=.*/)) return "meta";
    }
    if (state.header) {
      if (stream.match(/^@?[A-Za-z_.][A-Za-z0-9_.]*/)) return "labelName";
      stream.skipToEnd();
      return null;
    }
    if (stream.match(/^\\[nlpm]/)) return "escape";
    if (stream.match(/^\\./)) return "escape";
    if (stream.match(/^\[[0-9A-Fa-f]{2}\]/)) return "rawBytes";
    if (stream.match(/^\[[^\]]+\]/)) return "placeholder";
    if (stream.match(/^\{[^}]+\}/)) return "special";
    if (stream.match(/^<[^>]+>/)) return "rawBytes";
    stream.next();
    while (!stream.eol() && !/[\\[{<]/.test(stream.peek()!)) stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "//" } },
  tokenTable: {
    escape: tags.escape,
    placeholder: tags.special(tags.variableName),
    special: tags.atom,
    rawBytes: tags.processingInstruction,
    labelName: tags.labelName,
  },
});

/** ファイルの種類の言語。 */
export const languageExtension: EditorExtensionFactory = (ctx) => (ctx.kind === "string" ? stringLanguage : asmLanguage);
