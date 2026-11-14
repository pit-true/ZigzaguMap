import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateMacroExpression,
  formatCommandHover,
  formatCommandSignature,
  parseCommandCsv,
  parseMacroFile,
  resolveCommandArgumentKind,
  ScriptCommandTable,
  splitMacroCallArgs,
} from "../src/index.js";
import { GIVE_ITEM_MACROS, SETORCOPYVAR } from "./helpers/giveItemMacros.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/script/commands/${name}`, import.meta.url), "utf8");

/** 手で書いた commands.csv（BOM 付き、`#` の行、引用の中の `,` と改行と `""`）。 */
const CSV = [
  "﻿name,detail,hover,opcode,args",
  "",
  "#通常命令",
  'end,終了,"**end**\\\\nスクリプトを終了する",02,',
  'goto,オフセットジャンプ,"**goto** `destination`\\nジャンプする, 戻れない",05,A',
  'applymovement,オブジェクト移動,"**applymovement** 今のマップ",4F,2A',
  'applymovement,指定マップのオブジェクト移動,"**applymovement** 別のマップ",50,2A11',
  'msgbox,メッセージ表示,"1行目',
  '2行目の ""引用""",,A1(A)',
  "  # 字下げした # の行も飛ばす",
  '"#Org",オフセット指定,"**#Org** `@label`",,',
  "loadpointer,読み込み,ホバー,0x0F,1AA",
].join("\r\n");

const nd = () => ScriptCommandTable.build({ xseCommands: fixture("nd_style.s"), csv: CSV });
const chronos = () => ScriptCommandTable.build({ xseCommands: fixture("chronos_style.s") });

describe("parseMacroFile", () => {
  it("引数の :req・既定値・無印と、直前のコメントを読む", () => {
    const file = parseMacroFile(fixture("nd_style.s"));
    const lp = file.macros.find((m) => m.name === "loadpointer")!;
    expect(lp.params).toEqual([
      { name: "destination", required: true, vararg: false },
      { name: "value", required: true, vararg: false },
      { name: "value_kanji", required: false, vararg: false },
    ]);
    expect(lp.comment).toEqual([
      "Sets the specified script bank to immediate value.",
      "ND extends command 0x0F to take hiragana/kanji text pointers.",
    ]);
    const box = file.macros.find((m) => m.name === "updatecoinsbox")!;
    expect(box.params.map((p) => p.defaultValue)).toEqual(["0", "0"]);
    // 空行をはさんだ上の見出しは拾わず、すぐ上のコメントのまとまりだけを拾う。
    expect(file.macros.find((m) => m.name === "end")!.comment).toEqual(["Commands", "Terminates script execution."]);
    expect(file.macros.find((m) => m.name === "if")!.comment).toEqual([]);
  });

  it("/* */ の中のマクロは読まず、.equ は拾う", () => {
    const file = parseMacroFile(fixture("nd_style.s"));
    expect(file.macros.some((m) => m.name === "braillemessage_wait")).toBe(false);
    expect(file.constants.get("MSG_FIND")).toBe("0x1");
    expect(file.constants.get("STD_PUT_ITEM_AWAY")).toBe("STD_BASE + 0");
    expect(file.problems).toEqual([]);
  });

  it(".ifb / .else / .endif を分岐の文にする", () => {
    const lp = parseMacroFile(fixture("nd_style.s")).macros.find((m) => m.name === "loadpointer")!;
    expect(lp.body).toEqual([
      { type: "data", size: 1, values: ["0x0f"], line: 39 },
      { type: "data", size: 1, values: ["\\destination"], line: 40 },
      { type: "data", size: 4, values: ["\\value"], line: 41 },
      {
        type: "ifBlank",
        blank: true,
        test: "\\value_kanji",
        then: [{ type: "data", size: 4, values: ["\\value"], line: 43 }],
        else: [{ type: "data", size: 4, values: ["\\value_kanji"], line: 45 }],
        line: 42,
      },
    ]);
  });

  it("読めないマクロは理由を付けて続きを読む", () => {
    const text = [
      ".macro broken a:req",
      ".byte 0x01",
      ".align 2",
      ".endm",
      ".macro unclosed",
      ".ifb \\x",
      ".endm",
      ".macro ok",
      ".byte 0x02",
      ".endm",
      ".macro ok",
      ".byte 0x03",
      ".endm",
      ".macro tail",
      ".byte 0x04",
    ].join("\n");
    const file = parseMacroFile(text);
    expect(file.macros.map((m) => [m.name, m.body === null])).toEqual([
      ["broken", true],
      ["unclosed", true],
      ["ok", false],
      ["tail", true],
    ]);
    expect(file.problems.map((p) => [p.name, p.line, p.reason])).toEqual([
      ["broken", 1, "3 行目の .align には対応していません"],
      ["unclosed", 5, "6 行目の .ifb / .ifnb が .endif で閉じていません"],
      ["ok", 11, "同じ名前のマクロが前にもあります（後のものは使いません）"],
      ["tail", 14, ".endm で閉じていません"],
    ]);
  });

  it("マクロ呼び出しの引数は , か空白で分ける", () => {
    expect(splitMacroCallArgs("0x0 \\pointer \\pointer_kanji")).toEqual(["0x0", "\\pointer", "\\pointer_kanji"]);
    expect(splitMacroCallArgs("\\x, \\y")).toEqual(["\\x", "\\y"]);
    expect(splitMacroCallArgs("\\x + 1, (2 * 3)")).toEqual(["\\x + 1", "(2 * 3)"]);
    expect(splitMacroCallArgs("")).toEqual([]);
  });
});

describe("evaluateMacroExpression", () => {
  const names: Record<string, number> = { A: 0x10, B: 2 };
  const ev = (t: string) => evaluateMacroExpression(t, (n) => names[n] ?? null);
  it("数・名前・演算子を計算する", () => {
    expect(ev("0x1F")).toBe(0x1f);
    expect(ev("0b101")).toBe(5);
    expect(ev("A + B * 3")).toBe(0x16);
    expect(ev("(A + B) * 3")).toBe(54);
    expect(ev("A << 4 | B")).toBe(0x102);
    expect(ev("-1")).toBe(0xffffffff);
    expect(ev("'A'")).toBe(65);
  });
  it("知らない名前や壊れた式は null", () => {
    expect(ev("UNKNOWN")).toBeNull();
    expect(ev("A +")).toBeNull();
    expect(ev("1 / 0")).toBeNull();
    expect(ev("")).toBeNull();
  });
});

describe("バイトの並び", () => {
  it("ND の loadpointer は 10 バイト。漢字を省くとひらがなのポインタをもう一度書く", () => {
    const lp = nd().get("loadpointer")!;
    expect(lp.layout!.size).toBe(10);
    expect(lp.layout!.opcode).toBe(0x0f);
    expect(lp.layout!.composition).toBe("direct");
    expect(lp.layout!.variants).toEqual([
      {
        conditions: [{ param: "value_kanji", paramIndex: 2, blank: true }],
        fields: [
          { kind: "const", size: 1, value: 0x0f },
          { kind: "arg", size: 1, param: "destination", paramIndex: 0 },
          { kind: "arg", size: 4, param: "value", paramIndex: 1 },
          { kind: "arg", size: 4, param: "value", paramIndex: 1 },
        ],
        size: 10,
        opcode: 0x0f,
      },
      {
        conditions: [{ param: "value_kanji", paramIndex: 2, blank: false }],
        fields: [
          { kind: "const", size: 1, value: 0x0f },
          { kind: "arg", size: 1, param: "destination", paramIndex: 0 },
          { kind: "arg", size: 4, param: "value", paramIndex: 1 },
          { kind: "arg", size: 4, param: "value_kanji", paramIndex: 2 },
        ],
        size: 10,
        opcode: 0x0f,
      },
    ]);
  });

  it("Chronos の loadpointer は 6 バイトで型は 1 つ", () => {
    const lp = chronos().get("loadpointer")!;
    expect(lp.layout!.size).toBe(6);
    expect(lp.layout!.variants).toHaveLength(1);
    expect(chronos().get("loadword")!.layout).toMatchObject({ size: 6, composition: "alias", aliasOf: "loadpointer" });
  });

  it("msgbox は呼び先の loadpointer と callstd を展開し、まとめた命令とする", () => {
    const msgbox = nd().get("msgbox")!;
    expect(msgbox.layout).toMatchObject({ size: 12, opcode: 0x0f, composition: "compound" });
    // pointer_kanji を省いた型は、ひらがなのポインタを 2 回書く。
    const blank = msgbox.layout!.variants.find((v) => v.conditions[0]!.blank)!;
    expect(blank.fields.map((f) => (f.kind === "arg" ? f.param : f.kind === "const" ? f.value : f.kind))).toEqual([
      0x0f, 0, "pointer", "pointer", 0x09, "type",
    ]);
    expect(chronos().get("msgbox")!.layout).toMatchObject({ size: 8, composition: "compound" });
  });

  it("引数で命令番号の変わるマクロは、型ごとの命令番号を持つ", () => {
    const am = nd().get("applymovement")!;
    expect(am.layout).toMatchObject({ opcode: null, opcodes: [0x4f, 0x50], size: null, minSize: 7, maxSize: 9 });
    expect(am.layout!.variants.map((v) => [v.conditions, v.size])).toEqual([
      [[{ param: "mapGroup", paramIndex: 2, blank: true }], 7],
      [[{ param: "mapGroup", paramIndex: 2, blank: false }], 9],
    ]);
  });

  it("定数は .equ から求め、マクロの中のラベルは名前のまま残す", () => {
    const t = nd();
    expect(t.get("finditem")!.layout!.variants[0]!.fields).toEqual([
      { kind: "const", size: 1, value: 0x16 },
      { kind: "const", size: 2, value: 0x8000 },
      { kind: "arg", size: 2, param: "item", paramIndex: 0 },
      { kind: "const", size: 1, value: 0x09 },
      { kind: "const", size: 1, value: 0x01 },
    ]);
    expect(t.get("putitemaway")!.layout!.variants[0]!.fields[1]).toEqual({ kind: "const", size: 1, value: 0x08 });
    expect(chronos().get("givedecoration")!.layout!.variants[0]!.fields.at(-1)).toEqual({
      kind: "symbol",
      size: 4,
      text: "EventScript_SecretBase_GiveDecor",
    });
  });

  it("既定値のある引数は省いても既定値が入る", () => {
    const box = nd().get("updatecoinsbox")!;
    expect(box.layout!.variants).toHaveLength(1);
    expect(box.layout).toMatchObject({ size: 3, opcode: 0xc2, composition: "alias", aliasOf: "updatecoins" });
  });

  it("先頭が引数のマクロは命令番号を持たない", () => {
    const t = nd();
    expect(t.get("if")!.layout).toMatchObject({ opcode: null, opcodes: [], size: 6 });
    expect(t.get("levelscript")!.layout!.size).toBe(8);
  });

  it("呼び先が無いマクロや自分を呼ぶマクロは、理由を付けて一覧に出す", () => {
    const t = nd();
    expect(t.get("releasecurrentlayer")).toMatchObject({ layout: null });
    expect(t.problems.map((p) => [p.name, p.reason])).toEqual([
      ["releasecurrentlayer", "95 行目で呼んでいるマクロ map が見つかりません"],
      ["setobjectxyperm", "99 行目で setobjectxyperm が自分を呼び出しています（setobjectxyperm → setobjectxyperm）"],
    ]);
    expect(t.parsedCount).toBe(t.commands.length - 2);
  });

  it("命令番号から命令と型を引く", () => {
    const t = nd();
    expect(t.findByOpcode(0x50).map((m) => [m.command.name, m.variant.size])).toEqual([["applymovement", 9]]);
    expect(t.findByOpcode(0x05).map((m) => [m.command.name, m.command.layout!.composition])).toEqual([
      ["goto", "direct"],
      ["jump", "alias"],
    ]);
  });
});

describe("引数の種類と役割", () => {
  const kinds = (t: ScriptCommandTable, name: string) => t.get(name)!.args.map((a) => [a.name, a.kind, a.role]);

  it("ND の 2 ポインタ版は、文字列の引数がひらがなと漢字の 2 つになる", () => {
    const t = nd();
    expect(kinds(t, "loadpointer")).toEqual([
      ["destination", "constant", "destination: 命令の引数"],
      ["value", "string", "ひらがなテキスト"],
      ["value_kanji", "string", "漢字テキスト"],
    ]);
    expect(t.get("msgbox")!.args.filter((a) => a.kind === "string").map((a) => a.name)).toEqual(["pointer", "pointer_kanji"]);
    expect(kinds(t, "customchoice").map((k) => k[2])).toEqual([
      "上選択肢・ひらがな",
      "上選択肢・漢字",
      "下選択肢・ひらがな",
      "下選択肢・漢字",
    ]);
  });

  it("Chronos の 1 ポインタ版は、文字列の引数が 1 つになる", () => {
    const t = chronos();
    expect(t.get("loadpointer")!.args.filter((a) => a.kind === "string")).toHaveLength(1);
    expect(kinds(t, "msgbox")).toEqual([
      ["pointer", "string", "テキスト"],
      ["type", "constant", "type: 種類"],
    ]);
    expect(kinds(t, "customchoice").map((k) => k[2])).toEqual(["上選択肢", "下選択肢"]);
    expect(kinds(t, "npcmsgbox")).toEqual([
      ["localId", "constant", "localId: オブジェクトまたは対象ID"],
      ["text", "string", "テキスト"],
    ]);
  });

  it("ラベル・移動・変数・フラグを分ける", () => {
    const t = nd();
    expect(kinds(t, "goto")).toEqual([["destination", "label", "ジャンプ先スクリプトのラベル"]]);
    expect(t.get("applymovement")!.args.map((a) => a.kind)).toEqual(["constant", "movement", "constant", "constant"]);
    expect(t.get("setvar")!.args.map((a) => a.kind)).toEqual(["variable", "constant"]);
    expect(kinds(t, "setflag")).toEqual([["a", "flag", "ONにするイベントフラグ"]]);
    expect(t.get("levelscript")!.args.map((a) => a.kind)).toEqual(["variable", "constant", "label"]);
  });

  it("引数の大きさとポインタかどうかを持つ", () => {
    const [dest, value] = nd().get("loadpointer")!.args;
    expect(dest).toMatchObject({ sizes: [1], pointer: false, required: true });
    expect(value).toMatchObject({ sizes: [4], pointer: true });
  });

  it("書いた値で種類を決め直す", () => {
    const value = nd().get("loadpointer")!.args[1]!;
    const isString = (label: string) => label === "gText_Hello";
    expect(resolveCommandArgumentKind(value, "gText_Hello", isString)).toBe("string");
    expect(resolveCommandArgumentKind(value, "0x8000", isString)).toBe("constant");
    expect(resolveCommandArgumentKind(value, "EventScript_X", isString)).toBe("label");
    const dest = nd().get("goto")!.args[0]!;
    expect(resolveCommandArgumentKind(dest, "gText_Hello", isString)).toBe("string");
    expect(resolveCommandArgumentKind(dest, "EventScript_X", isString)).toBe("label");
  });
});

describe("commands.csv", () => {
  it("BOM・# の行・引用の中の , と改行と \"\" を読む", () => {
    const csv = parseCommandCsv(CSV);
    expect(csv.problems).toEqual([]);
    expect(csv.entries.map((e) => [e.name, e.opcode, e.args, e.line])).toEqual([
      ["end", 0x02, "", 4],
      ["goto", 0x05, "A", 5],
      ["applymovement", 0x4f, "2A", 6],
      ["applymovement", 0x50, "2A11", 7],
      ["msgbox", null, "A1(A)", 8],
      ["#Org", null, "", 11],
      ["loadpointer", 0x0f, "1AA", 12],
    ]);
    const byName = (n: string) => csv.entries.find((e) => e.name === n)!;
    expect(byName("end").hover).toBe("**end**\nスクリプトを終了する");
    expect(byName("goto").hover).toBe("**goto** `destination`\nジャンプする, 戻れない");
    expect(byName("msgbox").hover).toBe('1行目\r\n2行目の "引用"');
  });

  it("読めない opcode と空の name は理由を付けて飛ばす", () => {
    const csv = parseCommandCsv("name,detail,hover,opcode,args\nfoo,,,zz,\n,,,,\nbar,,,1,");
    expect(csv.entries.map((e) => [e.name, e.opcode])).toEqual([
      ["foo", null],
      ["bar", 1],
    ]);
    expect(csv.problems).toEqual([
      { line: 2, reason: "opcode が 16 進数ではありません: zz" },
      { line: 3, reason: "name が空です" },
    ]);
  });

  it("空の CSV は何も返さない", () => {
    expect(parseCommandCsv("")).toEqual({ entries: [], problems: [] });
    expect(parseCommandCsv("﻿# だけ\n")).toEqual({ entries: [], problems: [] });
  });

  it("マクロに CSV の説明を付け、命令番号の合う行を型ごとに選ぶ", () => {
    const t = nd();
    const am = t.get("applymovement")!;
    expect(am.csv).toHaveLength(2);
    expect(am.detail).toBe("オブジェクト移動");
    expect(am.layout!.variants.map((v) => t.csvForVariant(am, v)!.detail)).toEqual([
      "オブジェクト移動",
      "指定マップのオブジェクト移動",
    ]);
    expect(t.get("end")!.hover).toBe("**end**\nスクリプトを終了する");
    expect(t.get("MSGBOX")!.detail).toBe("メッセージ表示");
    expect(t.get("setvar")!.csv).toEqual([]);
  });

  it("CSV にだけある名前も引ける", () => {
    const t = nd();
    expect(t.csvOnly.map((c) => c.name)).toEqual(["#Org"]);
    expect(t.get("#org")).toMatchObject({ source: "csv", layout: null, detail: "オフセット指定" });
  });
});

describe("ホバー", () => {
  it("CSV の hover に引数の並びと定義の場所を足す", () => {
    const t = nd();
    expect(formatCommandSignature(t.get("loadpointer")!)).toBe("destination value [value_kanji]");
    expect(formatCommandSignature(t.get("updatecoinsbox")!)).toBe("[x=0] [y=0]");
    expect(formatCommandHover(t.get("goto")!)).toBe(
      "**goto** `destination`\nジャンプする, 戻れない\n\nSignature: `goto destination`  \nSource: `xse_commands.s:21`",
    );
  });

  it("CSV が無ければマクロの名前・引数・直前のコメント", () => {
    expect(formatCommandHover(chronos().get("customchoice")!, "cfru/xse_commands.s")).toBe(
      "**customchoice** `top bottom`\n\n" +
        "Displays the loaded message, then a custom two-choice menu.\n" +
        "One text pointer per option, like the standard 0x0F.\n\n" +
        "Source: `cfru/xse_commands.s:34`",
    );
  });
});

describe("定数", () => {
  it("defines の .equ も使い、xse_commands.s の方を優先する", () => {
    const t = ScriptCommandTable.build({
      xseCommands: ".equ A, 1\n.macro x\n.2byte LASTRESULT + A\n.endm\n",
      defines: [".equ LASTRESULT, 0x800D\n.equ A, 9\n"],
    });
    expect(t.resolveConstant("A")).toBe(1);
    expect(t.get("x")!.layout!.variants[0]!.fields).toEqual([{ kind: "const", size: 2, value: 0x800e }]);
  });

  it("自分を参照する定数でも止まらない", () => {
    const t = ScriptCommandTable.build({ xseCommands: ".equ A, B\n.equ B, A\n" });
    expect(t.resolveConstant("A")).toBeNull();
  });
});

describe("マクロの中のマクロの呼び出し（giveitem → copyvarifnotzero → setorcopyvar）", () => {
  const missing = () => ScriptCommandTable.build({ xseCommands: GIVE_ITEM_MACROS });
  const complete = () => ScriptCommandTable.build({ xseCommands: GIVE_ITEM_MACROS + SETORCOPYVAR });

  it("呼び先が欠けていれば、たどった道つきで組めないと分かる", () => {
    const t = missing();
    for (const name of ["copyvarifnotzero", "giveitem", "obtainitem", "finditem"]) {
      expect(t.canAssemble(name), name).toBe(false);
      expect(t.get(name)!.missingCalls.map((m) => m.name), name).toEqual(["setorcopyvar"]);
    }
    expect(t.get("obtainitem")!.missingCalls[0]!.via).toEqual(["obtainitem", "giveitem", "copyvarifnotzero"]);
    expect(t.get("giveitem")!.missingCalls[0]!.via).toEqual(["giveitem", "copyvarifnotzero"]);
    expect(t.get("obtainitem")!.layout).toBeNull();
    // 欠けていないマクロ（switch / case のように別のマクロを呼ぶものも）は組める
    for (const name of ["setvarifnotzero", "callstd", "switch", "case", "compare"]) expect(t.canAssemble(name), name).toBe(true);
    expect(t.get("case")!.layout).toMatchObject({ size: 11, composition: "compound" });
    expect(t.get("switch")!.layout).toMatchObject({ size: 5, opcode: 0x19, composition: "alias", aliasOf: "copyvar" });
    // 知らない名前と CSV だけの名前は組めない扱い
    expect(t.canAssemble("nosuch")).toBe(false);
  });

  it("呼び先がそろえば組めて、展開後のバイトの並びと長さが出る", () => {
    const t = complete();
    for (const name of ["copyvarifnotzero", "giveitem", "obtainitem", "finditem"]) {
      expect(t.canAssemble(name), name).toBe(true);
      expect(t.get(name)!.missingCalls, name).toEqual([]);
    }
    const layout = t.get("obtainitem")!.layout!;
    expect(layout).toMatchObject({ size: 12, opcode: 0x1a, composition: "alias", aliasOf: "giveitem" });
    expect(layout.variants[0]!.fields).toEqual([
      { kind: "const", size: 1, value: 0x1a },
      { kind: "const", size: 2, value: 0x8000 },
      { kind: "arg", size: 2, param: "item", paramIndex: 0 },
      { kind: "const", size: 1, value: 0x1a },
      { kind: "const", size: 2, value: 0x8001 },
      { kind: "arg", size: 2, param: "amount", paramIndex: 1 },
      { kind: "const", size: 1, value: 0x09 },
      { kind: "const", size: 1, value: 0x00 },
    ]);
    expect(t.get("finditem")!.layout!.variants[0]!.fields.at(-1)).toEqual({ kind: "const", size: 1, value: 0x01 });
    expect(t.get("giveitem")!.layout!.size).toBe(12);
  });

  it(".ifb / .ifnb のどちらの分岐の呼び先も調べ、同じ名前は 1 回だけ数える", () => {
    const text = [
      ".macro a x, y",
      ".ifb \\y",
      "\tnosuch1 \\x",
      ".else",
      "\tnosuch2 \\x",
      "\tnosuch1 \\y",
      ".endif",
      ".endm",
      ".macro b x",
      "\ta \\x",
      "\tb2",
      ".endm",
      ".macro b2",
      "\tb",
      ".endm",
    ].join("\n");
    const t = ScriptCommandTable.build({ xseCommands: text });
    expect(t.get("a")!.missingCalls.map((m) => m.name)).toEqual(["nosuch1", "nosuch2"]);
    // 自分を呼び返すマクロでも止まる
    expect(t.get("b")!.missingCalls.map((m) => `${m.via.join(">")}>${m.name}`)).toEqual(["b>a>nosuch1", "b>a>nosuch2"]);
  });
});
