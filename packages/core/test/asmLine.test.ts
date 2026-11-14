import { describe, expect, it } from "vitest";
import {
  applyAsmLineEnding,
  asmEquDefinition,
  asmGlobalNames,
  asmIncludePath,
  asmOpName,
  asmStringValue,
  asmTokenText,
  detectAsmLineEnding,
  parseAsmLine,
  splitAsmLines,
  type AsmLine,
} from "../src/index.js";

/** 区間を `種類:文字列` の並びにする。 */
function kinds(line: AsmLine): string[] {
  return line.tokens.map((t) => `${t.kind}:${asmTokenText(line, t)}`);
}

describe("parseAsmLine", () => {
  it.each([
    ["EventScript_A:", ["label:EventScript_A"]],
    ["\tlock", ["mnemonic:lock"]],
    ["\tmsgbox gText_A MSG_NORMAL", ["mnemonic:msgbox", "symbol:gText_A", "symbol:MSG_NORMAL"]],
    ["\tcompare 0x8004 0x6", ["mnemonic:compare", "number:0x8004", "number:0x6"]],
    ["\tsetvar 0x8000, -1", ["mnemonic:setvar", "number:0x8000", "number:-1"]],
    ["m_Walk: .byte walk_up, end_m", ["label:m_Walk", "directive:.byte", "symbol:walk_up", "symbol:end_m"]],
    ["a: b: nop", ["label:a", "label:b", "mnemonic:nop"]],
    ["1:", ["label:1"]],
    ['.string "a, b @ c"', ["directive:.string", 'string:"a, b @ c"']],
    ["\tsetvar VAR + 1, 2", ["mnemonic:setvar", "expression:VAR + 1", "number:2"]],
    ["\tsetvar (1 << 2) 3", ["mnemonic:setvar", "expression:(1 << 2)", "number:3"]],
    [".byte \\cond, \\type", ["directive:.byte", "macroArg:\\cond", "macroArg:\\type"]],
    ["\tend @ 終わり", ["mnemonic:end", "comment:@ 終わり"]],
    ["@ コメントだけ", ["comment:@ コメントだけ"]],
    ["# 行頭の #", ["comment:# 行頭の #"]],
    ["\tmov r0, #1", ["mnemonic:mov", "symbol:r0", "expression:#1"]],
    ["X: /* 途中 */ end", ["label:X", "comment:/* 途中 */", "mnemonic:end"]],
    ["/* 前 */ Y:", ["comment:/* 前 */", "label:Y"]],
    ["", []],
  ])("%s", (text, expected) => {
    expect(kinds(parseAsmLine(text))).toEqual(expected);
  });

  it("ラベル・命令・引数の桁を返す", () => {
    const line = parseAsmLine("m_Walk: .byte walk_up, end_m @ 歩く");
    expect(line.labels).toEqual([{ kind: "label", start: 0, end: 6 }]);
    expect(line.op).toEqual({ kind: "directive", start: 8, end: 13 });
    expect(line.args.map((a) => [a.start, a.end])).toEqual([
      [14, 21],
      [23, 28],
    ]);
    expect(line.comment).toBe("歩く");
    expect(asmOpName(line)).toBe(".byte");
  });

  it("`/* */` の中の状態を次の行に引き継ぐ", () => {
    const a = parseAsmLine("\tlock /* ここから");
    expect(a.endsInBlockComment).toBe(true);
    expect(kinds(a)).toEqual(["mnemonic:lock", "comment:/* ここから"]);
    const b = parseAsmLine("NotALabel: まだ中", a.endsInBlockComment);
    expect(b.startsInBlockComment).toBe(true);
    expect(b.endsInBlockComment).toBe(true);
    expect(b.labels).toEqual([]);
    expect(kinds(b)).toEqual(["comment:NotALabel: まだ中"]);
    const c = parseAsmLine("ここまで */ Real: end", b.endsInBlockComment);
    expect(c.endsInBlockComment).toBe(false);
    expect(kinds(c)).toEqual(["comment:ここまで */", "label:Real", "mnemonic:end"]);
    expect(parseAsmLine("", true).endsInBlockComment).toBe(true);
  });

  it("文字列の中の `/*` と `@` はコメントにしない", () => {
    const line = parseAsmLine('.ascii "/* @ */" @ 本当のコメント');
    expect(line.endsInBlockComment).toBe(false);
    expect(kinds(line)).toEqual(["directive:.ascii", 'string:"/* @ */"', "comment:@ 本当のコメント"]);
  });

  it(".include・.equ・.global を読む", () => {
    expect(asmIncludePath(parseAsmLine('.include "../xse_commands.s"'))).toBe("../xse_commands.s");
    expect(asmEquDefinition(parseAsmLine(".equ walk_up, 0x11"))).toEqual({ name: "walk_up", value: "0x11" });
    expect(asmEquDefinition(parseAsmLine(".equ  X ,  VAR_BASE + 1  @ 説明"))).toEqual({ name: "X", value: "VAR_BASE + 1" });
    expect(asmEquDefinition(parseAsmLine(".set Y, 2"))).toEqual({ name: "Y", value: "2" });
    expect(asmEquDefinition(parseAsmLine(".EQU Z,3"))).toEqual({ name: "Z", value: "3" });
    expect(asmEquDefinition(parseAsmLine(".byte 1"))).toBeNull();
    expect(asmGlobalNames(parseAsmLine(".global EventScript_A"))).toEqual(["EventScript_A"]);
    expect(asmGlobalNames(parseAsmLine(".globl a, b"))).toEqual(["a", "b"]);
    expect(asmGlobalNames(parseAsmLine("\tend"))).toEqual([]);
    expect(asmIncludePath(parseAsmLine("\tend"))).toBeNull();
  });

  it("文字列の中身を戻す", () => {
    expect(asmStringValue('"a\\"b\\\\c"')).toBe('a"b\\c');
    expect(asmStringValue('"閉じない')).toBe("閉じない");
    expect(asmStringValue("plain")).toBe("plain");
  });

  it("BOM と CR は空白として読む", () => {
    expect(kinds(parseAsmLine("﻿.text\r"))).toEqual(["directive:.text"]);
  });
});

describe("改行", () => {
  it("LF と CRLF を判定し、書き戻すときにそろえる", () => {
    expect(detectAsmLineEnding("a\nb\n")).toBe("\n");
    expect(detectAsmLineEnding("a\r\nb\r\n")).toBe("\r\n");
    expect(detectAsmLineEnding("a\r\nb\nc\r\n")).toBe("\r\n");
    expect(detectAsmLineEnding("改行なし")).toBe("\n");
    expect(applyAsmLineEnding("a\nb\r\nc\n", "\r\n")).toBe("a\r\nb\r\nc\r\n");
    expect(applyAsmLineEnding("a\r\nb\n", "\n")).toBe("a\nb\n");
    expect(splitAsmLines("a\r\nb\nc")).toEqual(["a", "b", "c"]);
  });
});
