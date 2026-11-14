import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DataError,
  DisasmCommandSet,
  Rom,
  ScriptCommandTable,
  ScriptTextCodec,
  disassembleScripts,
  movementNamesFromDefines,
  renderDisassembly,
} from "../src/index.js";

const MACROS = readFileSync(new URL("./fixtures/script/disasm/mini_commands.s", import.meta.url), "utf8");
const DEFINES = [".equ look_down, 0x0", ".equ walk_up, 0x11", ".equ exclaim, 0x62", ".equ end_m, 0xFE", ""].join("\n");
/** 小さな charmap.tbl（`?` は AC と EF の 2 つ。string.py は後の EF を使う）。 */
const CHARMAP = ["00= ", "01=あ", "02=い", "AC=?", "AC=？", "EF=?", "B7=\\$", "FB=\\p", "FE=\\n", "FC 88 9F=亜", "FF=$", "/FF", ""].join(
  "\n",
);

const commands = () =>
  DisasmCommandSet.fromCommandTable(ScriptCommandTable.build({ xseCommands: MACROS, defines: [DEFINES] }), movementNamesFromDefines(DEFINES));
const text = ScriptTextCodec.fromCharmap(CHARMAP);

/** バイト列を置いた小さな ROM（残りは 0xFF）。 */
function romWith(parts: [number, number[]][], size = 0x200): Rom {
  const bytes = new Uint8Array(size).fill(0xff);
  for (const [at, data] of parts) bytes.set(data, at);
  return new Rom(bytes);
}
const ptr = (offset: number) => {
  const v = (0x08000000 + offset) >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
};
const raw = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];

/** 分岐・文字列・移動・ショップ・知らない命令をひととおり入れたスクリプト。 */
const SAMPLE = romWith([
  [0x000, [0x16, 0x00, 0x80, 0x01, 0x00]], // setvar 0x8000 0x1
  [0x005, [0x06, 0x01, ...ptr(0x040)]], // goto_if 0x1 → 0x040
  [0x00b, [0x0f, 0x00, ...ptr(0x100), ...ptr(0x100)]], // loadpointer（漢字を省いた形）
  [0x015, [0x09, 0x04]], // callstd 0x4
  [0x017, [0x4f, 0xff, 0x00, ...ptr(0x120)]], // applymovement 0xFF → 0x120
  [0x01e, [0x04, ...ptr(0x080)]], // call → 0x080
  [0x023, [0x86, ...ptr(0x130)]], // mart → 0x130
  [0x028, [0x23, ...ptr(0x1f1)]], // callasm（たどらない）
  [0x02d, [0x05, ...ptr(0x000)]], // goto → 先頭（輪）
  [0x040, [0x0f, 0x00, ...ptr(0x100), ...ptr(0x110)]], // loadpointer（漢字あり）
  [0x04a, [0x5c, 0x01, 0x03, 0x00, 0x00, 0x00, ...ptr(0x100), ...ptr(0x110), ...ptr(0x070)]], // trainerbattle1
  [0x05c, [0x85, 0x00, ...raw(0x02021000)]], // bufferstring（RAM）
  [0x062, [0x05, ...ptr(0x00f)]], // goto → loadpointer の途中
  [0x070, [0x16, 0x01, 0x80, 0x02, 0x00, 0x02]], // setvar・end
  [0x080, [0x39, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xe0]], // warp・知らない命令
  [0x090, [0x05, ...raw(0x09000000)]], // goto → ROM の外
  [0x100, [0x01, 0x02, 0xfe, 0xac, 0xef, 0xfd, 0x01, 0xff]],
  [0x110, [0xfc, 0x88, 0x9f, 0xb7, 0xfb, 0x01, 0xff]],
  [0x120, [0x11, 0x62, 0x33, 0xfe]],
  [0x130, [0x0d, 0x00, 0x0e, 0x00, 0x00, 0x00]],
]);

describe("disassembleScripts", () => {
  it("分岐をたどり、ラベル・文字列・移動データ・ショップを付けて .s と .string にする", () => {
    const d = disassembleScripts(SAMPLE, [0x000, { offset: 0x090, label: "Entry2" }], { commands: commands(), text });
    expect(d.entries).toEqual([
      { offset: 0x000, label: "ROM_08000000" },
      { offset: 0x090, label: "Entry2" },
    ]);
    const out = renderDisassembly(d);
    expect(out.script.text).toBe(
      [
        "ROM_08000000:",
        "\tsetvar 0x8000 0x1",
        "\tgoto_if 0x1 ROM_08000040",
        "\tloadpointer 0x0 ROM_08000100",
        "\tcallstd 0x4",
        "\tapplymovement 0xFF ROM_08000120",
        "\tcall ROM_08000080",
        "\tmart ROM_08000130",
        "\tcallasm 0x80001F1",
        "\tgoto ROM_08000000",
        "",
        "ROM_08000040:",
        "\tloadpointer 0x0 ROM_08000100 ROM_08000110",
        "\ttrainerbattle1 0x1 0x3 0x0 ROM_08000100 ROM_08000110 ROM_08000070",
        "\tbufferstring 0x0 0x2021000",
        "\tgoto 0x800000F",
        "",
        "ROM_08000070:",
        "\tsetvar 0x8001 0x2",
        "\tend",
        "",
        "ROM_08000080:",
        "\twarp 0x3 0x0 0x1 0x0 0x0",
        "\t.byte 0xE0",
        "",
        "Entry2:",
        "\tgoto 0x9000000",
        "",
        "ROM_08000120:",
        "\t.byte walk_up, exclaim, 0x33, end_m",
        "",
        "\t.align 1",
        "ROM_08000130:",
        "\t.hword 0xD, 0xE, 0x0",
        "",
      ].join("\n"),
    );
    expect(out.strings.text).toBe(["#org @ROM_08000100", "あい\\n？?[PLAYER]", "", "#org @ROM_08000110", "亜\\$\\pあ", ""].join("\n"));
    expect(d.problems.map((p) => [p.offset, p.message])).toEqual([
      [0x00f, "0x0800000B の命令の途中から読もうとしました"],
      [0x088, "知らない命令 0xE0 です。ここで止めました"],
      [0x090, "destination のポインタ 0x09000000 が ROM の外です"],
    ]);
  });

  it("行ごとに ROM の位置を持ち、文字列はバイト列に戻せる", () => {
    const d = disassembleScripts(SAMPLE, [0x040], { commands: commands(), text });
    const out = renderDisassembly(d);
    const line = out.script.lines.find((l) => l.text.startsWith("\ttrainerbattle1"));
    expect(line?.offset).toBe(0x04a);
    expect(d.blocks.find((b) => b.offset === 0x040)!.lines[0]!.bytes).toEqual(SAMPLE.slice(0x040, 10));
    for (const s of d.strings) expect(text.encode(s.text)).toEqual(s.bytes);
  });

  it("命令の数の上限と、終端の無い文字列で止める", () => {
    const rom = romWith([
      [0x00, [0x0f, 0x00, ...ptr(0x10), ...ptr(0x10), 0x02]],
      [0x10, new Array(0x30).fill(0x01)],
    ]);
    const d = disassembleScripts(rom, [0x00], { commands: commands(), text, maxStringBytes: 8 });
    expect(d.strings).toEqual([]);
    expect(renderDisassembly(d).script.text).toContain("\tloadpointer 0x0 0x8000010\n\tend\n");
    expect(d.problems.map((p) => p.message)).toEqual(["文字列の終端が 8 バイトの中にありません"]);

    const loop = romWith([[0x00, new Array(8).fill(0x16)]]); // setvar が続き、終わりが無い
    const d2 = disassembleScripts(loop, [0x00], { commands: commands(), maxCommands: 1 });
    expect(d2.problems.map((p) => p.message)).toEqual(["命令の数が上限（1）を超えたので止めました"]);
  });

  it("入口が ROM の外なら問題に出す", () => {
    const d = disassembleScripts(SAMPLE, [0x1000], { commands: commands() });
    expect(d.blocks).toEqual([]);
    expect(d.problems).toEqual([{ offset: 0x1000, message: "入口が ROM の外です" }]);
  });
});

describe("DisasmCommandSet", () => {
  it("direct のマクロだけを使い、0F は漢字を省いた形を先に試す", () => {
    const set = commands();
    expect(set.find(0x0f).map((v) => [v.name, v.blankParams])).toEqual([
      ["loadpointer", [2]],
      ["loadpointer", []],
    ]);
    expect(set.find(0x05).map((v) => v.name)).toEqual(["goto", "jump"]);
    expect(set.variants.some((v) => v.name === "msgbox")).toBe(false);
    expect(set.movementNames.get(0x11)).toBe("walk_up");
  });

  it("短い文字列に書き出して読み直しても、同じ結果になる", () => {
    const set = commands();
    const again = DisasmCommandSet.parse(set.serialize(), { "11": "walk_up", "62": "exclaim", fe: "end_m" });
    expect(again.variants).toEqual(set.variants);
    const a = renderDisassembly(disassembleScripts(SAMPLE, [0x000], { commands: set, text }));
    const b = renderDisassembly(disassembleScripts(SAMPLE, [0x000], { commands: again, text }));
    expect(b).toEqual(a);
  });

  it("同梱の表は 1 ポインタの 0F（6 バイト）で、移動の名前を持つ", () => {
    const set = DisasmCommandSet.bundled();
    expect(set.find(0x0f).map((v) => v.size)).toEqual([6]);
    expect(set.find(0x02)[0]?.name).toBe("end");
    expect(set.find(0x5c).length).toBeGreaterThan(10);
    expect(set.movementNames.get(0xfe)).toBe("end_m");
    expect(set.find(0x2c)).toEqual([]);
  });
});

describe("ScriptTextCodec", () => {
  it("string.py と同じく、同じ字が複数あれば後の定義を使い、戻らない字は全角や [XX] にする", () => {
    expect(text.decode(Uint8Array.of(0xac, 0xef))).toBe("？?");
    expect(text.encode("？?")).toEqual(Uint8Array.of(0xac, 0xef));
    expect(text.decode(Uint8Array.of(0xfd, 0x06, 0xfd, 0x05))).toBe("[RIVAL][FD][05]");
    expect(text.decode(Uint8Array.of(0xfc, 0x99, 0x99, 0x77))).toBe("<FC 99 99>[77]");
    expect(text.encode("<FC 99 99>[77]")).toEqual(Uint8Array.of(0xfc, 0x99, 0x99, 0x77));
    expect(text.encode("\\$ $")).toEqual(Uint8Array.of(0xb7, 0x00, 0xff));
  });

  it("読めない書き方は DataError", () => {
    expect(() => text.encode("[NOPE]")).toThrow(DataError);
    expect(() => text.encode("う")).toThrow(DataError);
  });

  it("同梱の charmap で漢字と制御を戻す", () => {
    const jp = ScriptTextCodec.japanese;
    const bytes = jp.encode("[PLAYER]は\\n亜を 使った!\\p");
    expect(jp.decode(bytes)).toBe("[PLAYER]は\\n亜を 使った!\\p");
  });
});

describe("同梱の表をマクロの形にする（素の ROM のエディタの命令表）", () => {
  it("命令表に読み直すと、名前・命令番号・バイト数・引数の種類が同梱の表と同じ", () => {
    const bundled = DisasmCommandSet.bundled();
    const table = ScriptCommandTable.build({ xseCommands: bundled.toMacroText(), defines: [] });
    expect(table.problems).toEqual([]);
    const first = new Map<string, (typeof bundled.variants)[number]>();
    for (const v of bundled.variants) if (!first.has(v.name.toLowerCase())) first.set(v.name.toLowerCase(), v);
    expect(table.commands.length).toBe(first.size);
    for (const v of first.values()) {
      const c = table.get(v.name)!;
      expect(c, v.name).toBeTruthy();
      expect(c.layout?.variants[0]?.opcode).toBe(v.opcode);
      expect(c.layout?.variants[0]?.size).toBe(v.size);
      expect(c.args.map((a) => a.kind)).toEqual(v.params.map((p) => p.kind));
    }
    expect(table.get("loadpointer")!.args.map((a) => a.kind)).toEqual(["constant", "string"]);
  });
});
