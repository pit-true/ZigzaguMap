import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ScriptAssist,
  ScriptCommandTable,
  asmCompletionAt,
  asmDefinitionAt,
  asmHoverAt,
  asmSemanticTokens,
  completionLabels,
  lintAsmText,
  lintStringText,
  planStringBodyEdit,
  stringBodyOf,
} from "../src/index.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/script/commands/${name}`, import.meta.url), "utf8");

const DEFINES = [".equ LASTRESULT, 0x800D", ".equ VAR_TEMP_1, 0x8001", ".equ FLAG_X, 0x200 @ テストのフラグ", ".equ YES, 1", ".equ MSG_FACE, 2", ".equ MSG_SIGN, 3"].join("\n");
const SCRIPT = [
  "EventScript_Main:",
  "\tmsgbox gText_A MSG_FACE gText_A_k",
  "\tgoto EventScript_Sub",
  "",
  "EventScript_Sub:",
  "\tsetvar LASTRESULT 1",
  "\tend",
  "m_Walk: .byte walk_up, end_m",
].join("\n");
const STRINGS = ["#org @gText_A", "こんにちは", "", "#org @gText_A_k", "今日は"].join("\n");

function make(dialect: "nd" | "chronos"): ScriptAssist {
  const commands = ScriptCommandTable.build({ xseCommands: fixture(dialect === "nd" ? "nd_style.s" : "chronos_style.s") });
  const assist = new ScriptAssist({ commands });
  assist.updateAsm("xse_defines.s", DEFINES);
  assist.updateAsm("assembly/overworld_scripts/test.s", SCRIPT);
  assist.updateString("strings/test.string", STRINGS);
  return assist;
}

const kinds = (assist: ScriptAssist, line: string) => {
  const a = assist.analyze(line);
  return asmSemanticTokens(a).map((t) => `${line.slice(t.start, t.end)}:${t.kind}`);
};

describe("色付けの種類", () => {
  it("命令・文字列の参照・定数・ラベル・変数を分ける", () => {
    const nd = make("nd");
    expect(kinds(nd, "\tmsgbox gText_A MSG_FACE gText_A_k")).toEqual(["msgbox:command", "gText_A:textRef", "MSG_FACE:constant", "gText_A_k:textRef"]);
    expect(kinds(nd, "\tgoto EventScript_Sub")).toEqual(["goto:command", "EventScript_Sub:labelRef"]);
    expect(kinds(nd, "\tsetvar LASTRESULT 1")).toEqual(["setvar:command", "LASTRESULT:variable", "1:constant"]);
    expect(kinds(nd, "\tldr r0, =0x1")).toEqual(["ldr:instruction"]);
    expect(kinds(nd, "\tnosuchcommand 1")).toEqual(["nosuchcommand:unknownCommand"]);
    expect(kinds(nd, "m_Walk: .byte walk_up, end_m")).toEqual(["walk_up:constant", "end_m:constant"]);
  });
});

describe("ホバー", () => {
  it("ND の msgbox は、ひらがなと漢字の両方の本文を出す", () => {
    const nd = make("nd");
    const a = nd.analyze("\tmsgbox gText_A MSG_FACE gText_A_k");
    const h = asmHoverAt(nd, a, 9);
    expect(h?.type).toBe("string");
    if (h?.type !== "string") return;
    expect(h.refs.map((r) => [r.role, r.label, r.entries[0]?.text])).toEqual([
      ["ひらがなテキスト", "gText_A", "こんにちは"],
      ["漢字テキスト", "gText_A_k", "今日は"],
    ]);
    // 漢字を省くと、ラベルの無い参照として出す
    const omitted = asmHoverAt(nd, nd.analyze("\tmsgbox gText_A MSG_FACE"), 9);
    expect(omitted?.type === "string" && omitted.refs.map((r) => r.label)).toEqual(["gText_A", null]);
  });

  it("Chronos の msgbox は 1 つだけ", () => {
    const ch = make("chronos");
    const h = asmHoverAt(ch, ch.analyze("\tmsgbox gText_A MSG_FACE"), 9);
    expect(h?.type === "string" && h.refs.map((r) => r.role)).toEqual(["テキスト"]);
  });

  it("命令は Markdown、変数は説明、数は同じ値の名前を出す", () => {
    const nd = make("nd");
    const cmd = asmHoverAt(nd, nd.analyze("\tmsgbox gText_A MSG_FACE"), 2);
    expect(cmd?.type === "command" && cmd.markdown).toContain("**msgbox**");
    const v = asmHoverAt(nd, nd.analyze("\tsetvar LASTRESULT 1"), 10);
    expect(v?.type === "value" && [v.value, v.variable]).toEqual([0x800d, "LASTRESULT: 直前に実行したスクリプト命令の結果"]);
    const n = asmHoverAt(nd, nd.analyze("\tsetvar 0x800D 1"), 10);
    expect(n?.type === "value" && n.aliases).toEqual(["LASTRESULT"]);
    const label = asmHoverAt(nd, nd.analyze("\tgoto EventScript_Sub"), 8);
    expect(label?.type === "label" && label.labels[0]!.preview).toEqual(["setvar LASTRESULT 1", "end"]);
    expect(asmHoverAt(nd, nd.analyze("\tgoto X @ EventScript_Sub"), 12)).toBeNull();
  });
});

describe("補完", () => {
  it("命令名の位置では命令とディレクティブ、引数の位置では種類に合わせた候補", () => {
    const nd = make("nd");
    const op = asmCompletionAt(nd, nd.analyze("\tmsg"), 4);
    expect(op?.context).toBe("op");
    expect(completionLabels(op)).toContain("msgbox");
    expect(completionLabels(op)).toContain(".byte");
    const type = asmCompletionAt(nd, nd.analyze("\tmsgbox gText_A M"), 17);
    expect(type?.kind).toBe("msgType");
    expect(completionLabels(type)).toEqual(["MSG_OBTAIN", "MSG_FIND", "MSG_FACE", "MSG_SIGN", "MSG_KEEPOPEN", "MSG_YESNO", "MSG_NORMAL", "MSG_POKENAV"]);
    expect(type?.items.find((i) => i.label === "MSG_FACE")?.detail).toBe("MSG_FACE = 2");
    const text = asmCompletionAt(nd, nd.analyze("\tloadpointer 0 g"), 15);
    expect(completionLabels(text)).toEqual(["gText_A", "gText_A_k"]);
    const label = asmCompletionAt(nd, nd.analyze("\tgoto E"), 7);
    expect(completionLabels(label)).toEqual(["EventScript_Main", "EventScript_Sub", "m_Walk"]);
    const variable = asmCompletionAt(nd, nd.analyze("\tsetvar "), 8);
    expect(completionLabels(variable)).toEqual(["LASTRESULT", "VAR_TEMP_1"]);
    const flag = asmCompletionAt(nd, nd.analyze("\tsetflag "), 9);
    expect(completionLabels(flag)).toEqual(["FLAG_X"]);
    expect(asmCompletionAt(nd, nd.analyze("\tgoto X @ c"), 11)).toBeNull();
  });
});

describe("定義へ移動", () => {
  it("ラベル・文字列・.equ・マクロ", () => {
    const nd = make("nd");
    const at = (line: string, col: number) => asmDefinitionAt(nd, nd.analyze(line), col);
    expect(at("\tgoto EventScript_Sub", 8)?.targets).toEqual([{ path: "assembly/overworld_scripts/test.s", line: 5 }]);
    expect(at("\tmsgbox gText_A_k MSG_FACE", 10)).toMatchObject({ kind: "string", targets: [{ path: "strings/test.string", line: 4 }] });
    expect(at("\tsetvar LASTRESULT 1", 10)).toMatchObject({ kind: "equ", targets: [{ path: "xse_defines.s", line: 1 }] });
    expect(at("\tgoto EventScript_Sub", 2)?.kind).toBe("macro");
    expect(at("\tgoto Nowhere", 8)?.targets).toEqual([]);
  });
});

describe("波線", () => {
  it("知らない命令・引数の数・定義の無いラベル", () => {
    const nd = make("nd");
    const text = ["Start:", "\tnosuch 1", "\tgoto", "\tgoto Start Start", "\tgoto Missing", "\tgoto LocalLabel", "LocalLabel:", "\tpush {lr}"].join("\n");
    const found = lintAsmText(nd, text).map((d) => `${d.code}:${text.slice(d.from, d.to)}`);
    expect(found).toEqual(["unknownCommand:nosuch", "missingArgs:goto", "tooManyArgs:Start", "undefinedLabel:Missing"]);
  });

  it("`.if 0` の中とマクロの本文は調べない", () => {
    const nd = make("nd");
    const text = [".if 0", "\tgoto Missing", ".endif", ".macro mk num", "Gen\\num:", "\tgoto \\num", ".endm", "\tgoto Gen2"].join("\n");
    expect(lintAsmText(nd, text)).toEqual([]);
  });

  it(".string の重複したラベルと字数の超過", () => {
    const nd = make("nd");
    const text = ["#org @gText_A", "あいうえおかきくけこさしすせそたちつてと", "#org @gText_A", "x"].join("\n");
    const found = lintStringText(text, { path: "strings/other.string", strings: nd.strings, width: { maxColumns: 18 } });
    expect(found.map((d) => d.code)).toEqual(["duplicateStringOther", "duplicateString", "textWidth"]);
    expect(found[2]!.params).toMatchObject({ label: "gText_A", page: 1, line: 1, columns: 20, limit: 18 });
  });
});

describe(".string の本文の差し替え", () => {
  it("そのラベルの本文の行だけを変える", () => {
    const change = planStringBodyEdit(STRINGS, "gText_A", "さようなら");
    expect(change).toEqual({ from: 14, to: 19, insert: "さようなら" });
    const after = STRINGS.slice(0, change!.from) + change!.insert + STRINGS.slice(change!.to);
    expect(stringBodyOf(after, "gText_A")).toBe("さようなら");
    expect(stringBodyOf(after, "gText_A_k")).toBe("今日は");
    expect(planStringBodyEdit(STRINGS, "gText_A", "こんにちは")).toBeNull();
  });
});
