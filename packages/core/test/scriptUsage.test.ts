import { describe, expect, it } from "vitest";
import {
  DEFAULT_USAGE_CONFIG,
  DisasmCommandSet,
  MemoryProjectFs,
  Rom,
  ScriptCommandTable,
  UsageIndex,
  UsageProject,
  asmUsage,
  cSourceUsage,
  eventUsage,
  parseUsageConfig,
  romScriptUsage,
  type MapEvents,
} from "../src/index.js";

/** フラグ・変数・トレーナーを使う小さな命令表。 */
const MACROS = [
  ".macro end",
  ".byte 0x02",
  ".endm",
  ".macro setvar destination:req value:req",
  ".byte 0x16",
  ".hword \\destination",
  ".hword \\value",
  ".endm",
  ".macro setflag flag:req",
  ".byte 0x29",
  ".hword \\flag",
  ".endm",
  ".macro checkflag flag:req",
  ".byte 0x2B",
  ".hword \\flag",
  ".endm",
  ".macro trainer type:req index:req filler:req intro:req loss:req",
  ".byte 0x5C",
  ".byte \\type",
  ".hword \\index",
  ".hword \\filler",
  ".4byte \\intro",
  ".4byte \\loss",
  ".endm",
  "",
].join("\n");

const table = () => ScriptCommandTable.build({ xseCommands: MACROS, defines: [".equ FLAG_DEF, 0x30\n"] });
const commands = () => DisasmCommandSet.fromCommandTable(table(), new Map());

function romWith(parts: [number, number[]][], size = 0x400): Rom {
  const bytes = new Uint8Array(size).fill(0xff);
  for (const [at, data] of parts) bytes.set(data, at);
  return new Rom(bytes);
}
const ptr = (offset: number) => {
  const v = (0x08000000 + offset) >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
};

const events = (flag: number, variable: number, hidden: number, script = 0): MapEvents => ({
  persons: [
    {
      localId: 1, graphicsId: 0, kind: 0, padding1: 0, x: 0, y: 0, elevation: 0, movementType: 0, movementRangeX: 0, movementRangeY: 0,
      padding2: 0, trainerType: 0, trainerRangeOrBerryTree: 0, script, flag, padding3: 0,
    },
  ],
  warps: [],
  traps: [{ x: 0, y: 0, elevation: 0, padding1: 0, variable, value: 0, padding2: 0, script: 0 }],
  signs: [{ x: 0, y: 0, elevation: 0, kind: 7, padding: 0, content: { type: "hiddenItem", item: 1, flag: hidden, amount: 1, underfoot: false } }],
});

describe("UsageIndex", () => {
  it("使われていない最小の番号を返す（exclude と skip を飛ばす）", () => {
    const index = new UsageIndex();
    index.setSource("a", [
      { kind: "flag", value: 0x21, source: "asm", where: "a" },
      { kind: "flag", value: 0x22, source: "asm", where: "a" },
    ]);
    expect(index.next("flag", DEFAULT_USAGE_CONFIG.flag)).toBe(0x23);
    expect(index.next("flag", { from: 0x21, to: 0x30, exclude: [[0x23, 0x24]] })).toBe(0x25);
    expect(index.next("flag", DEFAULT_USAGE_CONFIG.flag, new Set([0x23]))).toBe(0x24);
    index.setSource("a", []);
    expect(index.next("flag", DEFAULT_USAGE_CONFIG.flag)).toBe(0x21);
    expect(index.next("flag", { from: 1, to: 1, exclude: [[1, 1]] })).toBeNull();
  });

  it("隠しアイテムの番号とフラグ（0x3E8 + 番号）を互いに見る", () => {
    const index = new UsageIndex();
    index.setSource("e", [{ kind: "hiddenItem", value: 1, source: "event", where: "e" }]);
    index.setSource("s", [{ kind: "flag", value: 0x3e8 + 2, source: "asm", where: "s" }]);
    expect(index.isUsed("flag", 0x3e9)).toBe(true);
    expect(index.next("hiddenItem", DEFAULT_USAGE_CONFIG.hiddenItem)).toBe(3);
    expect(index.find("hiddenItem", 2).map((s) => s.where)).toEqual(["s"]);
  });
});

describe("番号を集める", () => {
  it("イベント: 人のフラグ、スクリプトタイルの変数、隠しアイテム、条件表の変数", () => {
    const sites = eventUsage({ bank: 3, map: 0 }, events(0x200, 0x4050, 5), [
      { type: 2, pointer: 0, table: { entries: [{ variable: 0x4060, value: 1, script: 0 }], tail: new Uint8Array(8) } },
    ]);
    expect(sites.map((s) => [s.kind, s.value])).toEqual([
      ["flag", 0x200],
      ["var", 0x4050],
      ["hiddenItem", 5],
      ["var", 0x4060],
    ]);
    // 0 のフラグと 0x4000 未満の変数は数えない
    expect(eventUsage({ bank: 0, map: 0 }, events(0, 0x10, 0)).map((s) => s.kind)).toEqual(["hiddenItem"]);
  });

  it("素の ROM: 入口からたどって setflag・checkflag・setvar・trainerbattle を拾う", () => {
    const rom = romWith([
      [0x200, [0x29, 0x40, 0x00]], // setflag 0x40
      [0x203, [0x2b, 0x41, 0x00]], // checkflag 0x41
      [0x206, [0x16, 0x50, 0x40, 0x01, 0x00]], // setvar 0x4050 1
      [0x20b, [0x5c, 0x00, 0x2a, 0x00, 0x00, 0x00, ...ptr(0x300), ...ptr(0x300)]], // trainer 0 42 0
      [0x219, [0x02]],
    ]);
    const sites = romScriptUsage(rom, [0x200], { commands: commands(), where: "test" });
    expect(sites.map((s) => [s.kind, s.value])).toEqual([
      ["flag", 0x40],
      ["flag", 0x41],
      ["var", 0x4050],
      ["trainer", 42],
    ]);
  });

  it(".s: 数と .equ の名前（ほかのファイルの .equ と命令表の定数も）", () => {
    const text = ["Main:", "\tsetflag 0x45", "\tcheckflag FLAG_A + 1", "\tsetvar VAR_B 0x2", "\tsetflag FLAG_DEF", "\ttrainer 0x0 77 0x0 a b", "\tend", ""].join("\n");
    const names: Record<string, number> = { FLAG_A: 0x60, VAR_B: 0x4070 };
    const sites = asmUsage("assembly/a.s", text, table(), (n) => names[n] ?? table().resolveConstant(n));
    expect(sites.map((s) => [s.kind, s.value, s.line])).toEqual([
      ["flag", 0x45, 2],
      ["flag", 0x61, 3],
      ["var", 0x4070, 4],
      ["flag", 0x30, 5],
      ["trainer", 77, 6],
    ]);
  });

  it("C: flags.h の定義だけでは数えず、ほかのファイルに出てくる名前と config.h の定義を数える", () => {
    const sites = cSourceUsage([
      { path: "include/constants/flags.h", text: "#define SYS_FLAGS 0x800\n#define FLAG_A 0x123\n#define FLAG_B (SYS_FLAGS + 0x5)\n#define FLAG_UNUSED 0x124 // 未使用\n" },
      { path: "src/config.h", text: "#define FLAG_INVERSE 0x900\n//#define VAR_OFF 0x5007\n#define VAR_X 0x5000\n" },
      { path: "src/a.c", text: "void f(void) { FlagSet(FLAG_A); FlagGet(FLAG_B); /* FLAG_UNUSED */ }\n" },
    ]);
    expect(sites.map((s) => [s.kind, s.value]).sort()).toEqual(
      [
        ["flag", 0x123],
        ["flag", 0x805],
        ["flag", 0x900],
        ["var", 0x5000],
      ].sort(),
    );
  });
});

describe("UsageProject", () => {
  it("全部を作り、マップと .s を差し替える", async () => {
    const rom = romWith([[0x200, [0x29, 0x21, 0x00, 0x02]]]); // setflag 0x21; end
    const fs = new MemoryProjectFs();
    fs.files.set("assembly/overworld_scripts/a.s", ".equ FLAG_X, 0x22\nA:\n\tsetflag FLAG_X\n\tend\n");
    fs.files.set("src/b.c", "#define FLAG_Y 0x23\n");
    const project = await UsageProject.build({
      rom,
      commands: commands(),
      maps: [{ bank: 0, map: 0 }],
      map: () => ({ events: events(0x24, 0x4034, 1, 0x08000200), mapScripts: null }),
      fs,
      table: table(),
    });
    expect(project.built?.maps).toBe(1);
    expect(project.next("flag")).toBe(0x25);
    expect(project.next("var")).toBe(0x4035);
    expect(project.next("hiddenItem")).toBe(2);
    expect(project.find("flag", 0x21).map((s) => s.source)).toEqual(["rom"]);
    project.updateAsm("assembly/overworld_scripts/a.s", "A:\n\tend\n");
    expect(project.find("flag", 0x22)).toEqual([]);
    project.setMap({ bank: 0, map: 0 }, { events: events(0, 0, 0), mapScripts: null });
    expect(project.next("flag")).toBe(0x21);
  });

  it("設定の範囲（zigzagumap.json の usage）", () => {
    const c = parseUsageConfig(JSON.stringify({ usage: { flags: { from: "0x100", to: "0x1FF", exclude: ["0x100-0x10F", 272] } } }));
    expect(c.flag).toEqual({ from: 0x100, to: 0x1ff, exclude: [[0x100, 0x10f], [272, 272]] });
    expect(c.var).toEqual(DEFAULT_USAGE_CONFIG.var);
    expect(() => parseUsageConfig(JSON.stringify({ usage: { vars: { from: 5, to: 1 } } }))).toThrow();
  });
});
