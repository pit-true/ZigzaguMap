import { describe, expect, it } from "vitest";
import {
  StringFileError,
  appendStringEntry,
  checkStringFileWidth,
  endsWithBreakControl,
  findStringEntry,
  lintStringText,
  parseStringFile,
  removeStringEntry,
  replaceStringBody,
  resolveStringText,
  splitStringBodyLines,
  stringifyStringFile,
  wrapStringBody,
} from "../src/index.js";

// #221: .string の本文を、改行・改ページの制御記号のあとで実際に改行して書く。

describe("制御記号で終わる行", () => {
  it.each([
    ["\\n", true],
    ["あ\\p", true],
    ["あ\\l", true],
    ["あ\\m", true],
    ["あ\\n ", false],
    ["あ\\n　", false],
    ["あ\\$", false],
    ["あ\\\\n", false],
    ["あ\\\\\\n", true],
    ["あn", false],
    ["", false],
  ])("%s → %s", (text, expected) => {
    expect(endsWithBreakControl(text)).toBe(expected);
  });
});

describe("複数行の本文の読み方", () => {
  const source = [
    "#org @gText_Moegi_Npc3",
    "こんにちは！\\n",
    "きょうは いいてんきだね\\p",
    "またね",
    "",
    "#org @gText_B",
    "ひとつめ",
    "ふたつめ（別の文字列）",
    "",
  ].join("\n");
  const file = parseStringFile(source);

  it("制御記号で終わる行の次の行はつながる", () => {
    const e = findStringEntry(file, "gText_Moegi_Npc3")!;
    expect(e.text).toBe("こんにちは！\\nきょうは いいてんきだね\\pまたね");
    expect(e.textLines).toEqual([1, 2, 3]);
    expect(e.strings).toEqual([[1, 2, 3]]);
    expect(file.lines.map((l) => l.continued)).toEqual([false, false, true, true, false, false, false, false]);
    expect(resolveStringText(file, "gText_Moegi_Npc3")).toBe(e.text);
  });

  it("制御記号で終わらない行のあとは、これまでどおり別の文字列", () => {
    const e = findStringEntry(file, "gText_B")!;
    expect(e.text).toBe("ひとつめ");
    expect(e.strings).toEqual([[6], [7]]);
  });

  it.each([
    ["空行", "#org @A\nあ\\n\n\nい\n", "あ\\n"],
    ["コメント", "#org @A\nあ\\n\n// x\nい\n", "あ\\n"],
    ["#org", "#org @A\nあ\\n\n#org @B\nい\n", "あ\\n"],
    ["#ifdef", "#org @A\nあ\\n\n#ifdef X\nい\n#endif\n", "あ\\n"],
    ["後ろの空白", "#org @A\nあ\\n \nい\n", "あ\\n "],
    ["ファイルの終わり", "#org @A\nあ\\p", "あ\\p"],
  ])("%s ではつながらない", (_name, src, text) => {
    expect(findStringEntry(parseStringFile(src), "A")!.text).toBe(text);
  });

  it("続きの行の先頭の空白は文字のまま", () => {
    expect(findStringEntry(parseStringFile("#org @A\nあ\\n\n　い\n"), "A")!.text).toBe("あ\\n　い");
  });

  it("読んで書くと元に戻る", () => {
    expect(stringifyStringFile(file)).toBe(source);
  });
});

describe("複数行の本文の書き戻し", () => {
  it("改行は制御記号のすぐ後ろにだけ書ける", () => {
    expect(splitStringBodyLines("あ\\nい\\p\nう")).toEqual(["あ\\nい\\p", "う"]);
    expect(splitStringBodyLines("あ\\n\r\nい")).toEqual(["あ\\n", "い"]);
    expect(() => splitStringBodyLines("あ\nい")).toThrow(StringFileError);
    expect(() => splitStringBodyLines("あ\\n\n")).toThrow(StringFileError);
    expect(() => splitStringBodyLines("あ\\n\n// い")).toThrow(StringFileError);
    expect(() => splitStringBodyLines("あ\\n\n#org @X")).toThrow(StringFileError);
    // Chronos の幅検査が指定・設定として読む行も続きにしない
    expect(() => splitStringBodyLines("あ\\n\n#1")).toThrow(StringFileError);
    expect(() => splitStringBodyLines("あ\\n\nMAX_LENGTH")).toThrow(StringFileError);
    expect(wrapStringBody("あ\\n#いち\\nFILL_FF")).toBe("あ\\n#いち\\nFILL_FF");
  });

  it("1 行の本文を複数行に替え、ほかの行は変えない", () => {
    const src = "#org @A\r\nあ\\nい\r\n\r\n#org @B\r\nう\r\n";
    const out = stringifyStringFile(replaceStringBody(parseStringFile(src), "A", "あ\\n\nい\\p\nう"));
    expect(out).toBe("#org @A\r\nあ\\n\r\nい\\p\r\nう\r\n\r\n#org @B\r\nう\r\n");
    expect(findStringEntry(parseStringFile(out), "A")!.text).toBe("あ\\nい\\pう");
  });

  it("複数行の本文を 1 行に戻す", () => {
    const src = "#org @A\nあ\\n\nい\nべつ\n";
    const out = stringifyStringFile(replaceStringBody(parseStringFile(src), "A", "かえた"));
    expect(out).toBe("#org @A\nかえた\nべつ\n");
  });

  it("末尾に足すときも複数行で書ける", () => {
    const out = stringifyStringFile(appendStringEntry(parseStringFile("#org @A\nあ\n"), "B", "い\\n\nろ"));
    expect(out).toBe("#org @A\nあ\n\n#org @B\nい\\n\nろ\n");
  });

  it("制御記号のあとで分ける（分けた後ろが本文でなければ分けない）", () => {
    expect(wrapStringBody("こんにちは！\\nきょうは\\pまたね")).toBe("こんにちは！\\n\nきょうは\\p\nまたね");
    expect(wrapStringBody("あ\\p")).toBe("あ\\p");
    // 全角の空白と制御記号の行も本文として読まれるので分ける
    expect(wrapStringBody("あ\\n　\\nい")).toBe("あ\\n\n　\\n\nい");
    expect(wrapStringBody("あ\\n//い")).toBe("あ\\n//い");
    expect(wrapStringBody("あ\\$い\\lう")).toBe("あ\\$い\\l\nう");
    expect(wrapStringBody("あ\\\\nい")).toBe("あ\\\\nい");
    // 分けた形を読むと元の 1 行と同じ文字列
    for (const text of ["こんにちは！\\nきょうは\\pまたね", "[PLAYER]\\p\\pあ", "\\nい\\l"]) {
      const file = parseStringFile(`#org @A\n${wrapStringBody(text)}\n`);
      expect(findStringEntry(file, "A")!.text).toBe(text);
    }
  });
});

describe("複数行の本文の幅検査", () => {
  it("つないで数え、位置はそれぞれの行に戻す", () => {
    const long = "あ".repeat(20);
    const src = `#org @A\nいい\\n\n${long}\\p\nう\n`;
    const issues = checkStringFileWidth(parseStringFile(src));
    expect(issues).toHaveLength(1);
    const i = issues[0]!;
    expect(i).toMatchObject({ label: "A", fileLine: 2, page: 0, line: 1 });
    expect(src.slice(i.from, i.to)).toBe(long);
    expect(i.overflowFrom - i.from).toBe(18);
  });

  it("1 ページの行の数もつないで数える", () => {
    const issues = checkStringFileWidth(parseStringFile("#org @A\nいち\\n\nに\\n\nさん\n"));
    expect(issues.map((i) => [i.kind, i.fileLine])).toEqual([["lines", 3]]);
  });
});

describe("続きにならない本文の行の波線", () => {
  it("2 つ目からの文字列と、制御記号のあとの空白", () => {
    const src = "#org @A\nあ\\n\nい\nう\n\n#org @B\nえ\\n \nお\n";
    const found = lintStringText(src, { width: null });
    expect(found.map((d) => [d.code, src.slice(d.from, d.to)])).toEqual([
      ["strayStringLine", "う"],
      ["spaceAfterBreak", " "],
    ]);
  });
});

describe(".string のラベルを除く", () => {
  it("まとまりと後ろの空行を除き、次の見出しのコメントは残す", () => {
    const src = "#org @A\nあ\\n\nい\n\n// B の説明\n#org @B\nう\n";
    expect(stringifyStringFile(removeStringEntry(parseStringFile(src), "A"))).toBe("// B の説明\n#org @B\nう\n");
  });

  it("最後のまとまりを除くと、前の空行も除く", () => {
    const src = "#org @A\nあ\n\n#org @B\nう\n";
    expect(stringifyStringFile(removeStringEntry(parseStringFile(src), "B"))).toBe("#org @A\nあ\n");
    expect(stringifyStringFile(removeStringEntry(parseStringFile("#org @A\nあ\n\n#org @B\nう"), "B"))).toBe("#org @A\nあ");
  });

  it("取り込みの印のコメントも除く", () => {
    const src = "#org @A\nあ\n\n// ZigzaguMap: ROM 0x08123456 から取り込み\n#org @B\nう\n\n#org @C\nえ\n";
    expect(stringifyStringFile(removeStringEntry(parseStringFile(src), "B"))).toBe("#org @A\nあ\n\n#org @C\nえ\n");
  });

  it("文字列を共有している #org は、#org の行だけを除く", () => {
    const src = "#org @A\n#org @B\nう\n";
    expect(stringifyStringFile(removeStringEntry(parseStringFile(src), "B"))).toBe("#org @A\nう\n");
    expect(stringifyStringFile(removeStringEntry(parseStringFile(src), "A"))).toBe("#org @B\nう\n");
  });

  it("指定の行は残す", () => {
    const src = "#org @A\nあ\n#ifdef X\n#org @B\nい\n#endif\n";
    expect(stringifyStringFile(removeStringEntry(parseStringFile(src), "B"))).toBe("#org @A\nあ\n#ifdef X\n#endif\n");
  });

  it("無いラベルは誤り", () => {
    expect(() => removeStringEntry(parseStringFile("#org @A\nあ\n"), "Z")).toThrow(StringFileError);
  });
});
