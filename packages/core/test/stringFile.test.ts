import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  StringFileError,
  appendStringEntry,
  findStringEntry,
  parseStringFile,
  replaceStringBody,
  resolveStringText,
  stringFileNewline,
  stringLineOffsets,
  stringifyStringFile,
} from "../src/index.js";

const sample = readFileSync(new URL("./fixtures/script/strings/sample.string", import.meta.url), "utf8");

/** 2 つの文字列を行に分け、違う行の番号を返す。 */
function changedLines(a: string, b: string): number[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const out: number[] = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i);
  return out;
}

describe(".string の読み", () => {
  const file = parseStringFile(sample);

  it("行の種類を string.py と同じに分ける", () => {
    expect(file.lines.map((l) => l.kind)).toEqual([
      "directive",
      "setting",
      "blank",
      "comment",
      "header",
      "body",
      "blank",
      "header",
      "body",
      "blank",
      "header",
      "header",
      "body",
      "blank",
      "directive",
      "header",
      "body",
      "directive",
      "header",
      "body",
      "directive",
    ]);
    expect(file.settings).toEqual({ maxLength: 16, fillFF: false });
  });

  it("#org ごとのラベル・行の範囲・本文", () => {
    expect(file.entries.map((e) => e.label)).toEqual([
      "gText_Sample_Hello",
      "gText_Sample_Hello_k",
      "gText_Sample_Alias",
      "gText_Sample_Shared",
      "gText_Sample_Flag",
      "gText_Sample_NoFlag",
    ]);
    const hello = findStringEntry(file, "gText_Sample_Hello")!;
    expect(hello).toMatchObject({ headerLine: 4, bodyLines: [5], endLine: 7, text: "こんにちは！\\nいい　てんきですね。" });
    expect(findStringEntry(file, "gText_Sample_Alias")!.bodyLines).toEqual([]);
    expect(resolveStringText(file, "gText_Sample_Alias")).toBe(findStringEntry(file, "gText_Sample_Shared")!.text);
    // 本文の前後の空白は本文の一部（string.py は改行だけを除く）
    expect(findStringEntry(file, "gText_Sample_Flag")!.text).toBe("  まえに　くうはく ");
    expect(findStringEntry(file, "gText_Sample_Flag")!.conditions).toEqual(["SAMPLE_FLAG"]);
    expect(findStringEntry(file, "gText_Sample_NoFlag")!.conditions).toEqual(["!SAMPLE_FLAG"]);
    expect(findStringEntry(file, "gText_Missing")).toBeNull();
    expect(resolveStringText(file, "gText_Missing")).toBeNull();
  });

  it("続く行は連結せず、2 行目も本文の行として持つ", () => {
    const f = parseStringFile("#org @A\nいち\nに\n#org @B\nさん\n");
    expect(findStringEntry(f, "A")).toMatchObject({ bodyLines: [1, 2], text: "いち", endLine: 3 });
  });

  it("最初の #org の前は字下げした #org も見出し、あとは本文", () => {
    const f = parseStringFile("  #org @A\nあ\n  #org @B\n");
    expect(f.lines.map((l) => l.kind)).toEqual(["header", "body", "body"]);
    expect(f.entries.map((e) => e.label)).toEqual(["A"]);
  });

  it("全角の空白だけの行は空行（Python の strip と同じ）", () => {
    const f = parseStringFile("#org @A\n　　\nあ\n");
    expect(f.lines.map((l) => l.kind)).toEqual(["header", "blank", "body"]);
  });

  it("FILL_FF と知らない行", () => {
    const f = parseStringFile("FILL_FF=False\nなにか\n#org @A\nあ");
    expect(f.settings.fillFF).toBe(true);
    expect(f.lines[1]!.kind).toBe("unknown");
  });

  it.each([
    ["LF", sample],
    ["CRLF", sample.replace(/\n/g, "\r\n")],
    ["CR", sample.replace(/\n/g, "\r")],
    ["最後の改行なし", sample.replace(/\n$/, "")],
    ["BOM", `﻿${sample}`],
    ["改行がまざる", "#org @A\r\nあ\n\r\n#org @B\rい"],
    ["空", ""],
  ])("読んで書くと元に戻る（%s）", (_name, source) => {
    expect(stringifyStringFile(parseStringFile(source))).toBe(source);
  });

  it("改行の形と行の位置", () => {
    expect(stringFileNewline(parseStringFile(sample))).toBe("\n");
    expect(stringFileNewline(parseStringFile(sample.replace(/\n/g, "\r\n")))).toBe("\r\n");
    const f = parseStringFile("﻿ab\r\ncd\n");
    expect(stringLineOffsets(f)).toEqual([1, 5, 8]);
  });
});

describe(".string の書き戻し", () => {
  const file = parseStringFile(sample);

  it("本文を差し替えると、そのラベルの行だけが変わる", () => {
    const out = stringifyStringFile(replaceStringBody(file, "gText_Sample_Hello_k", "さようなら\\p[PLAYER]"));
    expect(changedLines(sample, out)).toEqual([8]);
    expect(out.split("\n")[8]).toBe("さようなら\\p[PLAYER]");
    // 元の形は変わらない
    expect(stringifyStringFile(file)).toBe(sample);
  });

  it("CRLF のファイルでも改行の形を保つ", () => {
    const crlf = sample.replace(/\n/g, "\r\n");
    const out = stringifyStringFile(replaceStringBody(parseStringFile(crlf), "gText_Sample_Hello", "あ"));
    expect(out).toBe(crlf.replace("こんにちは！\\nいい　てんきですね。", "あ"));
  });

  it("本文が 2 行のときは最初の行だけを替える", () => {
    const out = stringifyStringFile(replaceStringBody(parseStringFile("#org @A\nいち\nに\n"), "A", "かえた"));
    expect(out).toBe("#org @A\nかえた\nに\n");
  });

  it("本文の無い #org には直後に 1 行足す", () => {
    const out = stringifyStringFile(replaceStringBody(file, "gText_Sample_Alias", "べつ"));
    expect(out).toBe(sample.replace("#org @gText_Sample_Alias\n", "#org @gText_Sample_Alias\nべつ\n"));
    const last = stringifyStringFile(replaceStringBody(parseStringFile("#org @A\r\nあ\r\n#org @B"), "B", "い"));
    expect(last).toBe("#org @A\r\nあ\r\n#org @B\r\nい");
  });

  it.each([
    ["改行の文字", "あ\nい"],
    ["空", ""],
    ["空白だけ", "　"],
    ["コメント", "// あ"],
    ["#org", "#org @X"],
    ["#ifdef", "#ifdef X"],
  ])("本文として読まれない文字列は書かない（%s）", (_name, text) => {
    expect(() => replaceStringBody(file, "gText_Sample_Hello", text)).toThrow(StringFileError);
  });

  it("無いラベルは差し替えない", () => {
    expect(() => replaceStringBody(file, "gText_Missing", "あ")).toThrow(StringFileError);
  });

  it("末尾に新しいラベルを足す", () => {
    const out = stringifyStringFile(appendStringEntry(file, "gText_Sample_New", "あたらしい"));
    expect(out).toBe(`${sample}\n#org @gText_Sample_New\nあたらしい\n`);
    const added = parseStringFile(out);
    expect(findStringEntry(added, "gText_Sample_New")!.text).toBe("あたらしい");
  });

  it("末尾に足すときもファイルの改行の形に合わせる", () => {
    expect(stringifyStringFile(appendStringEntry(parseStringFile("#org @A\r\nあ"), "B", "い"))).toBe(
      "#org @A\r\nあ\r\n\r\n#org @B\r\nい",
    );
    expect(stringifyStringFile(appendStringEntry(parseStringFile("#org @A\nあ\n\n"), "B", "い"))).toBe(
      "#org @A\nあ\n\n#org @B\nい\n",
    );
    expect(stringifyStringFile(appendStringEntry(parseStringFile(""), "B", "い"))).toBe("#org @B\nい\n");
  });

  it("使えないラベル・重なるラベルは足さない", () => {
    expect(() => appendStringEntry(file, "gText_Sample_Hello", "あ")).toThrow(StringFileError);
    expect(() => appendStringEntry(file, "名前", "あ")).toThrow(StringFileError);
    expect(() => appendStringEntry(file, "a b", "あ")).toThrow(StringFileError);
  });
});
