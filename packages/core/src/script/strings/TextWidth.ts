// 文字数による簡易の幅検査。
//
// ピクセルでは数えない（ピクセルの検査は Chronos の tools/check_text_width.py）。1 行の字数と 1 ページの行数だけを見る。
// - 全角の字は 1、半角の字（ASCII の記号・英数字、半角カナ）は `halfwidthWeight`（既定 0.5）。
// - 空白は半角でも全角でも `spaceWeight`（既定 1。ゲームでは半角の空白も全角と同じ幅で描かれる）。
// - `[PLAYER]` などは `placeholderWidths` の字数（既定は入りうる最大の字数。下の表）。
// - 色・待ちなどの制御（`[RED]`、`[PAUSE_UNTIL_PRESS]`）と生のバイト（`[XX]`、`<XX YY>`）は 0。
// - `{Lv}` など `{...}` は `specialWidth`（既定 1）。`\$` などの記号は 1。
// - 行は `\n` `\l` `\m` で、ページは `\p` で区切る（check_text_width.py と同じく `\l` も 1 行と数える）。

import { splitStringPages, type StringToken } from "./StringText.js";
import { stringLineOffsets, type StringFile } from "./StringFile.js";

/** 幅検査の設定。省いた項目は既定の値。 */
export interface TextWidthOptions {
  /** 1 行の字数の上限（既定 18。Chronos の窓 208px に全角 10px の字が入る数）。 */
  readonly maxColumns?: number;
  /** 1 ページの行数の上限（既定 2）。 */
  readonly maxLines?: number;
  /** 半角の字の重み（既定 0.5）。 */
  readonly halfwidthWeight?: number;
  /** 空白（半角・全角）の重み（既定 1）。 */
  readonly spaceWeight?: number;
  /** プレースホルダの字数。キーは本文に書く形（`[PLAYER]`、`{Lv}`）。既定の表に上書きして使う。 */
  readonly placeholderWidths?: Readonly<Record<string, number>>;
  /** 表に無い `[名前]` の字数（既定 0）。 */
  readonly unknownPlaceholderWidth?: number;
  /** 表に無い `{...}` の字数（既定 1）。 */
  readonly specialWidth?: number;
  /** `[XX]` と `<XX YY>` の字数（既定 0）。 */
  readonly rawByteWidth?: number;
}

/** 1 行の字数の上限の既定。 */
export const TEXT_WIDTH_DEFAULT_COLUMNS = 18;
/** 1 ページの行数の上限の既定。 */
export const TEXT_WIDTH_DEFAULT_LINES = 2;

/**
 * プレースホルダの既定の字数（入りうる最大の字数。FR 日本語版の名前の長さを目安にした大まかな値）。
 * - 主人公・ライバル・トレーナーの名前 5、ポケモンの名前 6。
 * - `[BUFFER1]` などは何が入るか分からないので、道具・技の名前の 8。
 * - 戦闘のポケモン（`[ATTACKER]` など）は「あいての 」と名前で 11。
 * - 矢印・ボタンの絵、`[.]`（…）は 1。色・待ちなどの制御は表に無く 0。
 */
export const TEXT_WIDTH_DEFAULT_PLACEHOLDERS: Readonly<Record<string, number>> = {
  "[PLAYER]": 5,
  "[RIVAL]": 5,
  "[PLAYER_NAME]": 5,
  "[TRAINER1_NAME]": 5,
  "[TRAINER1_CLASS]": 6,
  "[BUFFER]": 8,
  "[BUFFER1]": 8,
  "[BUFFER2]": 8,
  "[BUFFER3]": 8,
  "[ATTACKER]": 11,
  "[TARGET]": 11,
  "[EFFECT_BANK]": 11,
  "[SCRIPTING_BANK]": 11,
  "[TARGET_NAME]": 6,
  "[TARGET_PARTNER_NAME]": 6,
  "[CURRENT_MOVE]": 8,
  "[LAST_ITEM]": 8,
  "[LAST_ABILITY]": 8,
  "[ATTACKER_ABILITY]": 8,
  "[TARGET_ABILITY]": 8,
  "[SCRIPTING_BANK_ABILITY]": 8,
  "[.]": 1,
  "[ARROW_UP]": 1,
  "[ARROW_DOWN]": 1,
  "[ARROW_LEFT]": 1,
  "[ARROW_RIGHT]": 1,
  "[A_BUTTON]": 1,
  "[B_BUTTON]": 1,
  "[L_BUTTON]": 1,
  "[R_BUTTON]": 1,
  "[START_BUTTON]": 1,
  "[SELECT_BUTTON]": 1,
  "[DPAD_UP]": 1,
  "[DPAD_DOWN]": 1,
  "[DPAD_LEFT]": 1,
  "[DPAD_RIGHT]": 1,
  "[DPAD_UP_DOWN]": 1,
  "[DPAD_LEFT_RIGHT]": 1,
  "[DPAD]": 1,
};

/** 検査した 1 行。 */
export interface TextWidthLine {
  /** ページの番号（0 から）。 */
  readonly page: number;
  /** ページの中の行の番号（0 から）。 */
  readonly line: number;
  /** 本文の中の行の始まり（UTF-16 の位置）。 */
  readonly start: number;
  /** 本文の中の行の終わり（含まない）。 */
  readonly end: number;
  /** 行の字数（重みを掛けた合計）。 */
  readonly columns: number;
}

/** 上限を超えたところ。 */
export interface TextWidthIssue extends TextWidthLine {
  /** `columns` は 1 行の字数、`lines` はページの行数が上限を超えた。 */
  readonly kind: "columns" | "lines";
  /** 超えた上限。 */
  readonly limit: number;
  /** 超え始めた位置。`columns` は上限を超えた最初の字句の始まり、`lines` は行の始まり。 */
  readonly overflowStart: number;
}

/** 本文 1 つの検査の結果。 */
export interface TextWidthResult {
  readonly lines: readonly TextWidthLine[];
  readonly issues: readonly TextWidthIssue[];
}

function isSpace(c: string): boolean {
  return c === " " || c === "　";
}

function isHalfwidth(code: number): boolean {
  return (code >= 0x21 && code <= 0x7e) || (code >= 0xff61 && code <= 0xff9f);
}

/** 字句 1 つの字数。 */
function tokenWidth(token: StringToken, options: TextWidthOptions): number {
  switch (token.kind) {
    case "char": {
      if (isSpace(token.text)) return options.spaceWeight ?? 1;
      return isHalfwidth(token.text.codePointAt(0)!) ? (options.halfwidthWeight ?? 0.5) : 1;
    }
    case "escape":
      return 1;
    case "placeholder":
    case "special": {
      const width = options.placeholderWidths?.[token.text] ?? TEXT_WIDTH_DEFAULT_PLACEHOLDERS[token.text];
      if (width !== undefined) return width;
      return token.kind === "special" ? (options.specialWidth ?? 1) : (options.unknownPlaceholderWidth ?? 0);
    }
    case "rawByte":
    case "rawBytes":
      return options.rawByteWidth ?? 0;
    default:
      return 0;
  }
}

/** 本文 1 つ（.string の 1 行）を検査する。 */
export function checkTextWidth(text: string, options: TextWidthOptions = {}): TextWidthResult {
  const maxColumns = options.maxColumns ?? TEXT_WIDTH_DEFAULT_COLUMNS;
  const maxLines = options.maxLines ?? TEXT_WIDTH_DEFAULT_LINES;
  const lines: TextWidthLine[] = [];
  const issues: TextWidthIssue[] = [];
  for (const [p, page] of splitStringPages(text).entries()) {
    for (const [l, line] of page.lines.entries()) {
      let columns = 0;
      let overflowStart = -1;
      for (const token of line.tokens) {
        columns += tokenWidth(token, options);
        if (overflowStart < 0 && columns > maxColumns) overflowStart = token.start;
      }
      const result: TextWidthLine = { page: p, line: l, start: line.start, end: line.end, columns };
      lines.push(result);
      if (overflowStart >= 0) issues.push({ ...result, kind: "columns", limit: maxColumns, overflowStart });
      if (l >= maxLines) issues.push({ ...result, kind: "lines", limit: maxLines, overflowStart: line.start });
    }
  }
  return { lines, issues };
}

/** .string の中の、上限を超えたところ。 */
export interface StringFileWidthIssue extends TextWidthIssue {
  /** 本文の行の `#org` のラベル。 */
  readonly label: string;
  /** 本文の行の番号（0 から）。 */
  readonly fileLine: number;
  /** ファイルの文字列の中の範囲（`stringifyStringFile` の位置。BOM を含めて数える）。行の始まりから終わりまで。 */
  readonly from: number;
  readonly to: number;
  /** ファイルの文字列の中の、超え始めた位置。 */
  readonly overflowFrom: number;
}

/** .string のすべての本文の行を検査する。 */
export function checkStringFileWidth(file: StringFile, options: TextWidthOptions = {}): StringFileWidthIssue[] {
  const out: StringFileWidthIssue[] = [];
  const offsets = stringLineOffsets(file);
  for (const entry of file.entries) {
    for (const lineNumbers of entry.strings) {
      // 制御記号のあとで分けた行はつないで 1 つの文字列として数え、位置はそれぞれの行に戻す
      const starts: number[] = [];
      let text = "";
      for (const n of lineNumbers) {
        starts.push(text.length);
        text += file.lines[n]!.text;
      }
      const at = (pos: number, end: boolean): { line: number; offset: number } => {
        let k = starts.length - 1;
        while (k > 0 && (end ? starts[k]! >= pos : starts[k]! > pos)) k--;
        const line = lineNumbers[k]!;
        return { line, offset: offsets[line]! + pos - starts[k]! };
      };
      for (const issue of checkTextWidth(text, options).issues) {
        const from = at(issue.start, false);
        out.push({
          ...issue,
          label: entry.label,
          fileLine: from.line,
          from: from.offset,
          to: at(issue.end, true).offset,
          overflowFrom: at(issue.overflowStart, false).offset,
        });
      }
    }
  }
  return out;
}
