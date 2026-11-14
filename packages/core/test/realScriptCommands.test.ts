import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScriptCommandTable } from "../src/index.js";

/** xse_commands.s のあるフォルダと commands.csv のパス。設定されていなければ、そのテストは飛ばす。 */
const ndDir = process.env.ZIGZAGU_ND_DIR;
const chronosDir = process.env.ZIGZAGU_CHRONOS_DIR;
const csvPath = process.env.ZIGZAGU_COMMANDS_CSV;

/** フォルダの xse_commands.s と、あれば xse_defines.s・asm_defines.s から命令表を作る。 */
function load(dir: string): ScriptCommandTable {
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const defines = ["xse_defines.s", "asm_defines.s"].filter((n) => existsSync(join(dir, n))).map(read);
  return ScriptCommandTable.build({
    xseCommands: read("xse_commands.s"),
    csv: csvPath ? readFileSync(csvPath, "utf8") : null,
    defines,
  });
}

/** 文字列の引数の名前。 */
const stringArgs = (t: ScriptCommandTable, name: string) =>
  t.get(name)!.args.filter((a) => a.kind === "string").map((a) => a.name);

/** 両方のファイルで、呼び先のマクロが xse_commands.s に無いもの（古い XSE の名前を呼ぶ別名）。 */
const MISSING_CALLEES = [
  "writebytetooffset",
  "copyvarifnotzero",
  "comparefarbytetobyte",
  "comparefarbytes",
  "comparevars",
  "playbgm",
  "playsong2",
  "fadenewbgm",
  "setobjectxy",
  "turnobject",
  "moveobjectoffscreen",
  "setobjectmovementtype",
  "message",
  "closemessage",
  "waitbuttonpress",
  "drawmonpic",
  "erasemonpic",
  "setflashradius",
  "dofieldeffect",
  "setrespawn",
  "releasecurrentlayer",
  "createvobject",
  "turnvobject",
  "showcoinsbox",
  "hidecoinsbox",
  "updatecoinsbox",
  "setescape",
  "warppanel2",
  "giveitem",
  "finditem",
  "obtainitem",
  "putitemaway",
  "giveitemwithfanfare",
  "comparedayofweek",
  "comparehour",
];

describe.skipIf(!ndDir)("ND の xse_commands.s（ZIGZAGU_ND_DIR）", () => {
  it("全マクロを読み、読めないものは理由つきで一覧に出る", () => {
    const t = load(ndDir!);
    expect(t.commands).toHaveLength(312);
    expect(t.parsedCount).toBe(276);
    expect(t.problems.map((p) => p.name).sort()).toEqual([...MISSING_CALLEES, "setobjectxyperm"].sort());
    expect(t.problems.find((p) => p.name === "setobjectxyperm")!.reason).toContain("自分を呼び出しています");
    expect(t.problems.find((p) => p.name === "setescape")!.reason).toContain("マクロ map が見つかりません");
  });

  it("loadpointer は 10 バイトの 2 ポインタ、msgbox・customchoice の文字列の引数は 2 つと 4 つ", () => {
    const t = load(ndDir!);
    expect(t.get("loadpointer")!.layout).toMatchObject({ opcode: 0x0f, size: 10, composition: "direct" });
    expect(t.get("loadpointer")!.layout!.variants).toHaveLength(2);
    expect(stringArgs(t, "loadpointer")).toEqual(["value", "value_kanji"]);
    expect(stringArgs(t, "msgbox")).toEqual(["pointer", "pointer_kanji"]);
    expect(t.get("msgbox")!.layout).toMatchObject({ size: 12, composition: "compound" });
    expect(stringArgs(t, "customchoice")).toEqual(["top", "top_kanji", "bottom", "bottom_kanji"]);
    expect(t.get("customchoice")!.layout).toMatchObject({ opcode: 0x74, size: 17 });
  });

  it("主な命令のバイト数と引数の種類", () => {
    const t = load(ndDir!);
    const sizes = Object.fromEntries(
      ["end", "goto", "goto_if", "setvar", "setflag", "checkflag", "msg", "trainerbattle1", "special2"]
        .filter((n) => t.get(n))
        .map((n) => [n, t.get(n)!.layout!.size]),
    );
    expect(sizes).toEqual({ end: 1, goto: 5, goto_if: 6, setvar: 5, setflag: 3, checkflag: 3, msg: 5, trainerbattle1: 18, special2: 5 });
    expect(t.get("applymovement")!.layout).toMatchObject({ opcodes: [0x4f, 0x50], minSize: 7, maxSize: 9 });
    expect(t.get("applymovement")!.args.map((a) => a.kind)).toEqual(["constant", "movement", "constant", "constant"]);
    expect(t.get("goto")!.args[0]!.kind).toBe("label");
    expect(t.get("setvar")!.args.map((a) => a.kind)).toEqual(["variable", "constant"]);
    expect(t.get("setflag")!.args[0]!.kind).toBe("flag");
    // xse_defines.s の LASTRESULT を使う。
    expect(t.get("candodailyevent")!.layout!.variants[0]!.fields.at(-2)).toEqual({ kind: "const", size: 2, value: 0x800d });
  });
});

describe.skipIf(!chronosDir)("Chronos の xse_commands.s（ZIGZAGU_CHRONOS_DIR）", () => {
  it("全マクロを読み、読めないものは理由つきで一覧に出る", () => {
    const t = load(chronosDir!);
    expect(t.commands).toHaveLength(314);
    expect(t.parsedCount).toBe(278);
    expect(t.problems.map((p) => p.name).sort()).toEqual([...MISSING_CALLEES, "setobjectxyperm"].sort());
  });

  it("loadpointer は 6 バイトの 1 ポインタ、msgbox・customchoice の文字列の引数は 1 つと 2 つ", () => {
    const t = load(chronosDir!);
    expect(t.get("loadpointer")!.layout).toMatchObject({ opcode: 0x0f, size: 6 });
    expect(t.get("loadpointer")!.layout!.variants).toHaveLength(1);
    expect(stringArgs(t, "loadpointer")).toEqual(["value"]);
    expect(stringArgs(t, "msgbox")).toEqual(["pointer"]);
    expect(t.get("msgbox")!.layout!.size).toBe(8);
    expect(stringArgs(t, "customchoice")).toEqual(["top", "bottom"]);
    expect(t.get("customchoice")!.layout).toMatchObject({ opcode: 0x74, size: 9 });
  });

  it("Chronos だけの命令", () => {
    const t = load(chronosDir!);
    expect(t.get("npcmsgbox")!.layout).toMatchObject({ opcode: 0x2c, size: 6 });
    expect(stringArgs(t, "npcmsgbox")).toEqual(["text"]);
    expect(t.get("settimeofday")!.layout).toMatchObject({ opcode: 0x2d, size: 2 });
    expect(t.get("givedecoration")!.layout).toMatchObject({ size: 10, composition: "compound" });
  });
});

describe.skipIf(!csvPath || !ndDir)("commands.csv（ZIGZAGU_COMMANDS_CSV）", () => {
  it("CSV の hover がマクロの命令に付く", () => {
    const t = load(ndDir!);
    expect(t.problems.filter((p) => p.file === "csv")).toEqual([]);
    expect(t.commands.filter((c) => c.hover !== "").length).toBeGreaterThan(200);
    expect(t.get("loadpointer")!.hover.startsWith("**loadpointer**")).toBe(true);
    expect(t.get("loadpointer")!.detail).not.toBe("");
    const am = t.get("applymovement")!;
    expect(am.layout!.variants.map((v) => t.csvForVariant(am, v)!.opcode)).toEqual([0x4f, 0x50]);
    // CSV にだけある名前（コンパイラ用の命令など）も引ける。
    expect(t.get("#Org")).toMatchObject({ source: "csv" });
  });
});
