import { describe, expect, it } from "vitest";
import {
  checkStringFileWidth,
  checkTextWidth,
  formatStringText,
  parseStringFile,
  splitStringPages,
  stringifyStringFile,
  tokenizeStringText,
} from "../src/index.js";

describe("本文の字句とページ", () => {
  it("制御の字句を分ける", () => {
    const tokens = tokenizeStringText("あ\\n[PLAYER]{Lv}<FC 09>[FD]\\$\\p");
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([
      ["char", "あ"],
      ["lineBreak", "\\n"],
      ["placeholder", "[PLAYER]"],
      ["special", "{Lv}"],
      ["rawBytes", "<FC 09>"],
      ["rawByte", "[FD]"],
      ["escape", "\\$"],
      ["pageBreak", "\\p"],
    ]);
    expect(tokens[2]).toMatchObject({ start: 3, end: 11 });
  });

  it("閉じていない括弧はふつうの字", () => {
    expect(tokenizeStringText("[あ").map((t) => t.kind)).toEqual(["char", "char"]);
  });

  it("\\p で改ページ、\\n \\l で改行し、[PLAYER] などはそのまま見せる", () => {
    const text = "[PLAYER]は\\nみた。\\pつぎ\\lさいご<FF 09>";
    const pages = splitStringPages(text);
    expect(pages.map((p) => p.lines.map((l) => l.text))).toEqual([["[PLAYER]は", "みた。"], ["つぎ", "さいご<FF 09>"]]);
    expect(pages[1]!.lines[1]).toMatchObject({ start: text.indexOf("さいご"), end: text.length });
    expect(formatStringText(text)).toBe("[PLAYER]は\nみた。\n\nつぎ\nさいご<FF 09>");
    expect(splitStringPages("").map((p) => p.lines.length)).toEqual([1]);
  });
});

describe("簡易の幅検査", () => {
  const cases: [string, string, number][] = [
    ["全角 18 字", "あ".repeat(18), 18],
    ["全角 19 字", "あ".repeat(19), 19],
    ["半角は 0.5", "ABCD", 2],
    ["半角の空白も 1", "あ あ", 3],
    ["全角の空白", "あ　あ", 3],
    ["[PLAYER] は 5", "[PLAYER]", 5],
    ["[BUFFER1] は 8", "[BUFFER1]", 8],
    ["{Lv} は 1", "{Lv}", 1],
    ["色・生のバイトは 0", "[RED][FD]<FC 09>", 0],
    ["表に無い [名前] は 0", "[SOMETHING]", 0],
    ["\\$ は 1", "\\$", 1],
  ];
  it.each(cases)("%s", (_name, text, columns) => {
    expect(checkTextWidth(text).lines[0]!.columns).toBe(columns);
  });

  it("18 字までは出さず、19 字目から出す", () => {
    expect(checkTextWidth("あ".repeat(18)).issues).toEqual([]);
    const text = `いい\\n${"あ".repeat(19)}`;
    expect(checkTextWidth(text).issues).toEqual([
      { kind: "columns", page: 0, line: 1, start: 4, end: text.length, columns: 19, limit: 18, overflowStart: 4 + 18 },
    ]);
  });

  it("1 ページの行数", () => {
    const issues = checkTextWidth("あ\\nい\\lう\\pえ\\nお").issues;
    expect(issues).toEqual([{ kind: "lines", page: 0, line: 2, start: 6, end: 7, columns: 1, limit: 2, overflowStart: 6 }]);
  });

  it("上限と重みを設定で変える", () => {
    expect(checkTextWidth("あ".repeat(19), { maxColumns: 20 }).issues).toEqual([]);
    expect(checkTextWidth("あ\\nい\\nう", { maxLines: 3 }).issues).toEqual([]);
    expect(checkTextWidth("ABCD", { halfwidthWeight: 1 }).lines[0]!.columns).toBe(4);
    expect(checkTextWidth("[PLAYER]", { placeholderWidths: { "[PLAYER]": 7 } }).lines[0]!.columns).toBe(7);
    expect(checkTextWidth("[FOO]", { unknownPlaceholderWidth: 2 }).lines[0]!.columns).toBe(2);
    expect(checkTextWidth("<FC 09>", { rawByteWidth: 1 }).lines[0]!.columns).toBe(1);
    expect(checkTextWidth("{X}", { specialWidth: 0 }).lines[0]!.columns).toBe(0);
  });

  it("プレースホルダの最大の字数で超える", () => {
    // 13 字 + [PLAYER] の 5 字 = 18 字は収まり、14 字 + 5 字は超える
    expect(checkTextWidth(`${"あ".repeat(13)}[PLAYER]`).issues).toEqual([]);
    expect(checkTextWidth(`${"あ".repeat(14)}[PLAYER]`).issues[0]).toMatchObject({ columns: 19, overflowStart: 14 });
  });

  it(".string の中の位置で返す", () => {
    const source = `﻿// c\r\n#org @A\r\nいい\\n${"あ".repeat(19)}\r\n#org @B\r\nう\r\n`;
    const file = parseStringFile(source);
    const issues = checkStringFileWidth(file);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue).toMatchObject({ label: "A", fileLine: 2, kind: "columns" });
    const text = stringifyStringFile(file);
    expect(text.slice(issue.from, issue.to)).toBe("あ".repeat(19));
    expect(text.slice(issue.overflowFrom, issue.to)).toBe("あ");
  });
});
