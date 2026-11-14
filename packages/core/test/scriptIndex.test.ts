import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MemoryProjectFs,
  ScriptIndex,
  buildScriptIndex,
  indexAsmFile,
  isScriptSourcePath,
  listScriptSourcePaths,
  reloadScriptIndexFile,
} from "../src/index.js";

const SAMPLE_PATH = "assembly/overworld_scripts/sample.s";
const sample = readFileSync(new URL("./fixtures/script/asm/sample.s", import.meta.url), "utf8");

const DEFINES = [
  ".thumb",
  ".equ PLAYER, 0xFF @ 主人公",
  "",
  ".equ look_down, 0x0",
  ".equ walk_up, 0x11",
  "",
  ".equ end_m, 0xFE",
  ".equ AFTER, 0x1",
  "",
].join("\n");

describe("indexAsmFile", () => {
  const entry = indexAsmFile(SAMPLE_PATH, sample);

  it("ラベル・行・桁・.global を拾い、`/* */` の中は拾わない", () => {
    expect(entry.labels.map((l) => [l.name, l.line, l.column, l.global])).toEqual([
      ["EventScript_Sample", 15, 0, true],
      ["EventScript_Sample_Yes", 26, 0, false],
      ["m_SampleWalk", 30, 0, false],
      ["m_SampleLook", 31, 0, false],
    ]);
    expect(entry.labels.every((l) => l.path === SAMPLE_PATH)).toBe(true);
  });

  it("プレビューは続く数行（コメントを除く）。同じ行の .byte も入れ、次のラベルで止める", () => {
    const byName = new Map(entry.labels.map((l) => [l.name, l.preview]));
    expect(byName.get("EventScript_Sample")).toEqual(["lock", "faceplayer", "msgbox gText_Sample MSG_NORMAL", "compare LASTRESULT 0x1"]);
    expect(byName.get("EventScript_Sample_Yes")).toEqual(["setflag SAMPLE_FLAG", "end"]);
    expect(byName.get("m_SampleWalk")).toEqual([".byte walk_up, walk_up, end_m"]);
  });

  it(".equ の値と説明、.include を拾う", () => {
    expect(entry.equs.map((e) => [e.name, e.value, e.description, e.line])).toEqual([
      ["SAMPLE_FLAG", "0x200", "サンプルのフラグ", 11],
      ["SAMPLE_VAR", "VAR_BASE + 1", null, 12],
    ]);
    expect(entry.includes).toEqual(["../xse_commands.s", "../xse_defines.s"]);
    expect(entry.lineEnding).toBe("\n");
    expect(entry.movements).toEqual([]);
  });

  it("CRLF のファイルも同じに読み、改行を覚える", () => {
    const crlf = indexAsmFile(SAMPLE_PATH, sample.replace(/\n/g, "\r\n"));
    expect(crlf.lineEnding).toBe("\r\n");
    expect(crlf.labels).toEqual(entry.labels);
    expect(crlf.equs).toEqual(entry.equs);
  });

  it("移動の名前は xse_defines.s の look_down から end_m まで", () => {
    const defines = indexAsmFile("xse_defines.s", DEFINES);
    expect(defines.movements).toEqual(["look_down", "walk_up", "end_m"]);
    expect(defines.equs[0]).toMatchObject({ name: "PLAYER", value: "0xFF", description: "主人公" });
    expect(indexAsmFile("asm_defines.s", DEFINES).movements).toEqual([]);
  });
});

describe("ScriptIndex", () => {
  it("1 ファイルを読み直すと、そのファイルの分だけが入れ替わる", () => {
    const index = new ScriptIndex();
    index.updateFile("assembly/a.s", "Shared:\n\tend\nOnlyA:\n\tend\n.equ CONST_A, 1\n");
    index.updateFile("assembly/b.s", "Shared:\n\treturn\nOnlyB:\n\tend\n.equ CONST_B, 2\n");
    expect(index.findLabels("Shared").map((l) => l.path)).toEqual(["assembly/a.s", "assembly/b.s"]);

    index.updateFile("assembly/a.s", "Renamed:\n\tend\n.equ CONST_A, 3\n");
    expect(index.findLabel("OnlyA")).toBeUndefined();
    expect(index.findLabel("Renamed")?.path).toBe("assembly/a.s");
    expect(index.findLabels("Shared").map((l) => l.path)).toEqual(["assembly/b.s"]);
    expect(index.findLabel("OnlyB")).toMatchObject({ path: "assembly/b.s", line: 3 });
    expect(index.findEqu("CONST_A")?.value).toBe("3");
    expect(index.findEqu("CONST_B")?.value).toBe("2");
    expect(index.labelNames().sort()).toEqual(["OnlyB", "Renamed", "Shared"]);

    index.removeFile("assembly/b.s");
    expect(index.findLabels("Shared")).toEqual([]);
    expect(index.paths()).toEqual(["assembly/a.s"]);
  });

  it("名前は大文字・小文字を区別する", () => {
    const index = new ScriptIndex();
    index.updateFile("assembly/a.s", "Label:\nlabel:\n");
    expect(index.findLabels("Label")).toHaveLength(1);
    expect(index.findLabels("LABEL")).toEqual([]);
  });

  it("写し（JSON）から同じ索引に戻せる", () => {
    const index = new ScriptIndex();
    index.updateFile(SAMPLE_PATH, sample.replace(/\n/g, "\r\n"));
    index.updateFile("xse_defines.s", DEFINES);
    const copy = ScriptIndex.fromSnapshot(JSON.parse(JSON.stringify(index.toSnapshot())));
    expect(copy.paths()).toEqual(index.paths());
    for (const path of index.paths()) expect(copy.file(path)).toEqual(index.file(path));
    expect(copy.lineEndingOf(SAMPLE_PATH)).toBe("\r\n");
    expect(copy.movementNames()).toEqual(["look_down", "walk_up", "end_m"]);
    expect(() => ScriptIndex.fromSnapshot({ format: 99, files: [] })).toThrow();
  });
});

describe("ProjectFs からの索引", () => {
  const makeFs = () => {
    const fs = new MemoryProjectFs();
    fs.files.set(SAMPLE_PATH, sample);
    fs.files.set("assembly/battle_scripts/b.s", "BattleScript_X:\n\tend\n");
    fs.files.set("assembly/data/table.bin", new Uint8Array([1, 2]));
    fs.files.set("assembly/main.s", "Main:\n");
    fs.files.set("xse_defines.s", DEFINES);
    fs.files.set("strings/a.string", "#org @gText_A\nあ\n");
    return fs;
  };

  it("assembly/**/*.s と直下の xse_*.s・asm_defines.s を読む", async () => {
    const fs = makeFs();
    expect(await listScriptSourcePaths(fs)).toEqual([
      "assembly/battle_scripts/b.s",
      "assembly/main.s",
      SAMPLE_PATH,
      "xse_defines.s",
    ]);
    const index = await buildScriptIndex(fs);
    expect(index.findLabel("BattleScript_X")?.path).toBe("assembly/battle_scripts/b.s");
    expect(index.findEqu("walk_up")?.value).toBe("0x11");
    expect(isScriptSourcePath("assembly/x/y.s")).toBe(true);
    expect(isScriptSourcePath("asm_defines.s")).toBe(true);
    expect(isScriptSourcePath("strings/a.string")).toBe(false);
    expect(isScriptSourcePath("other.s")).toBe(false);
  });

  it("変わったファイルだけ読み直し、消えたファイルは索引から消す", async () => {
    const fs = makeFs();
    const index = await buildScriptIndex(fs);
    const before = index.file("assembly/main.s");
    fs.files.set(SAMPLE_PATH, "EventScript_New:\n\tend\n");
    expect(await reloadScriptIndexFile(index, fs, SAMPLE_PATH)).toBe(true);
    expect(index.findLabel("EventScript_Sample")).toBeUndefined();
    expect(index.findLabel("EventScript_New")?.path).toBe(SAMPLE_PATH);
    expect(index.file("assembly/main.s")).toBe(before);

    fs.files.delete("assembly/battle_scripts/b.s");
    expect(await reloadScriptIndexFile(index, fs, "assembly/battle_scripts/b.s")).toBe(false);
    expect(index.findLabel("BattleScript_X")).toBeUndefined();
  });
});
