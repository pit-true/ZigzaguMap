import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRIPT_LABEL_TEMPLATE,
  MemoryProjectFs,
  ProjectFormatError,
  SCRIPT_CONFIG_FILE,
  ScriptConfigJson,
  defaultScriptConfig,
  detectScriptDialect,
  expandScriptLabelTemplate,
  loadScriptConfig,
  resolveScriptConfig,
  resolveScriptConfigPath,
  saveScriptConfig,
  type ScriptConfigSettings,
} from "../src/index.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/script/config/${name}`, import.meta.url), "utf8");

describe("方言の判定", () => {
  it("loadpointer に 3 つ目の引数があれば nd、無ければ chronos", () => {
    expect(detectScriptDialect(fixture("xse_commands_nd.s"))).toBe("nd");
    expect(detectScriptDialect(fixture("xse_commands_chronos.s"))).toBe("chronos");
  });

  it("CRLF・大文字・空白区切りでも読む。マクロが無ければ null", () => {
    expect(detectScriptDialect(".MACRO LoadPointer destination:req value:req value_kanji\r\n.endm\r\n")).toBe("nd");
    expect(detectScriptDialect("  .macro loadpointer dest, value @ 説明\n")).toBe("chronos");
    expect(detectScriptDialect(".macro loadpointer2 a, b, c\n.macro loadword a, b, c\n")).toBeNull();
    expect(detectScriptDialect("")).toBeNull();
  });
});

describe("既定値", () => {
  it("ND は CFRU のビルドだけ、幅検査なし、.global なし", () => {
    const c = defaultScriptConfig("nd");
    expect(c.build).toEqual([{ command: "python", args: ["scripts/make.py"], cwd: "." }]);
    expect(c.outputRom).toBe("test.gba");
    expect(c.widthCheck).toBeNull();
    expect(c.useGlobal).toBe(false);
    expect(c.commandsCsv).toBeNull();
    expect(c.labelTemplate).toBe(DEFAULT_SCRIPT_LABEL_TEMPLATE);
    expect([c.lineMaxChars, c.linesPerPage]).toEqual([18, 2]);
  });

  it("Chronos は 1 つ上で build.py、幅検査あり、.global あり", () => {
    const c = defaultScriptConfig("chronos");
    expect(c.build).toEqual([{ command: "python", args: ["build.py"], cwd: ".." }]);
    expect(c.outputRom).toBe("../build/Chronos.gba");
    expect(c.widthCheck).toEqual({ command: "python", args: ["tools/check_text_width.py", "--source"], cwd: ".." });
    expect(c.useGlobal).toBe(true);
    expect([c.lineMaxChars, c.linesPerPage]).toEqual([18, 2]);
  });

  it("書いてある項目だけ既定値を上書きし、null は「使わない」になる", () => {
    const c = resolveScriptConfig({ widthCheck: null, lineMaxChars: 20 }, "chronos");
    expect(c.widthCheck).toBeNull();
    expect(c.lineMaxChars).toBe(20);
    expect(c.build).toEqual(defaultScriptConfig("chronos").build);
  });

  it("既定値の配列は呼ぶたびに別物（書き換えても次に影響しない）", () => {
    defaultScriptConfig("nd").build[0]!.args.push("x");
    expect(defaultScriptConfig("nd").build[0]!.args).toEqual(["scripts/make.py"]);
  });
});

describe("zigzagumap.json の読み書き", () => {
  const full: ScriptConfigSettings = {
    dialect: "nd",
    build: [
      { command: "python", args: ["scripts/make.py"], cwd: "." },
      { command: "python", args: ["scripts/make.py"], cwd: "../NeoDark-DPE-main" },
    ],
    outputRom: "../NeoDark-DPE-main/test.gba",
    widthCheck: { command: "python", args: ["check.py", "--source"], cwd: ".." },
    labelTemplate: "Script_{map}_{index}",
    useGlobal: true,
    lineMaxChars: 16,
    linesPerPage: 3,
    commandsCsv: "../tools/commands.csv",
  };

  it("書いて読み直すと同じ値になる", () => {
    const text = ScriptConfigJson.stringify(full);
    expect(ScriptConfigJson.parse(text).settings).toEqual(full);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("ファイルが無い・節が無いときは空の設定", () => {
    expect(ScriptConfigJson.parse(null).settings).toEqual({});
    expect(ScriptConfigJson.parse('{ "other": 1 }').settings).toEqual({});
  });

  it("知らない項目（最上位と節の中）は消さずに残す", () => {
    const before = JSON.stringify({ version: 3, map: { theme: "dark" }, script: { dialect: "auto", future: [1, 2] } });
    const doc = ScriptConfigJson.parse(before);
    const after = JSON.parse(ScriptConfigJson.stringify({ ...doc.settings, lineMaxChars: 20 }, doc));
    expect(after).toEqual({ version: 3, map: { theme: "dark" }, script: { dialect: "auto", future: [1, 2], lineMaxChars: 20 } });
  });

  it("undefined にした項目は消えて既定値に戻る", () => {
    const doc = ScriptConfigJson.parse(ScriptConfigJson.stringify(full));
    const after = ScriptConfigJson.parse(ScriptConfigJson.stringify({ dialect: "nd" }, doc));
    expect(after.settings).toEqual({ dialect: "nd" });
  });

  it("パスの \\ は / にそろえ、args と cwd は省略できる", () => {
    const text = JSON.stringify({ script: { outputRom: "..\\build\\x.gba", build: [{ command: "make" }] } });
    expect(ScriptConfigJson.parse(text).settings).toEqual({
      outputRom: "../build/x.gba",
      build: [{ command: "make", args: [], cwd: "." }],
    });
  });

  it("形式が不正なら ProjectFormatError", () => {
    const bad = [
      "{",
      "[]",
      '{ "script": 1 }',
      '{ "script": { "dialect": "fr" } }',
      '{ "script": { "build": {} } }',
      '{ "script": { "build": [{ "command": "" }] } }',
      '{ "script": { "build": [{ "command": "a", "args": [1] }] } }',
      '{ "script": { "lineMaxChars": 0 } }',
      '{ "script": { "linesPerPage": 1.5 } }',
      '{ "script": { "useGlobal": "yes" } }',
      '{ "script": { "outputRom": "" } }',
    ];
    for (const text of bad) expect(() => ScriptConfigJson.parse(text), text).toThrow(ProjectFormatError);
  });
});

describe("プロジェクトからの読み込みと保存", () => {
  it("設定が無ければ xse_commands.s から方言を判定して既定値を入れる", async () => {
    const fs = new MemoryProjectFs();
    fs.files.set("xse_commands.s", fixture("xse_commands_nd.s"));
    const nd = await loadScriptConfig(fs);
    expect(nd.dialectSource).toBe("detected");
    expect(nd.config).toEqual(defaultScriptConfig("nd"));

    fs.files.set("xse_commands.s", fixture("xse_commands_chronos.s"));
    expect((await loadScriptConfig(fs)).config.dialect).toBe("chronos");
  });

  it("方言を書いてあれば判定しない。xse_commands.s が無ければ chronos", async () => {
    const fs = new MemoryProjectFs();
    expect((await loadScriptConfig(fs)).dialectSource).toBe("fallback");
    fs.files.set(SCRIPT_CONFIG_FILE, JSON.stringify({ script: { dialect: "nd" } }));
    fs.files.set("xse_commands.s", fixture("xse_commands_chronos.s"));
    const loaded = await loadScriptConfig(fs);
    expect(loaded.dialectSource).toBe("setting");
    expect(loaded.config.dialect).toBe("nd");
    expect(loaded.config.dialectSetting).toBe("nd");
  });

  it("保存すると今のファイルの知らない項目を残す", async () => {
    const fs = new MemoryProjectFs();
    fs.files.set(SCRIPT_CONFIG_FILE, JSON.stringify({ keep: true, script: { extra: "x" } }));
    await saveScriptConfig(fs, { useGlobal: false });
    expect(JSON.parse(await fs.readText(SCRIPT_CONFIG_FILE))).toEqual({ keep: true, script: { extra: "x", useGlobal: false } });
    expect((await loadScriptConfig(fs)).settings).toEqual({ useGlobal: false });
  });
});

describe("補助", () => {
  it("ラベルの規則を埋める", () => {
    expect(expandScriptLabelTemplate(DEFAULT_SCRIPT_LABEL_TEMPLATE, { map: "03_00", kind: "Npc", index: 0 })).toBe(
      "EventScript_03_00_Npc0",
    );
  });

  it("設定のパスをプロジェクトフォルダにつなぐ", () => {
    expect(resolveScriptConfigPath("D:\\work\\Chronos\\cfru", "../build/Chronos.gba")).toBe("D:/work/Chronos/build/Chronos.gba");
    expect(resolveScriptConfigPath("D:/work/nd/", ".")).toBe("D:/work/nd");
    expect(resolveScriptConfigPath("/home/a/nd", "./scripts/../test.gba")).toBe("/home/a/nd/test.gba");
    expect(resolveScriptConfigPath("D:/work/nd", "E:\\emu\\mGBA.exe")).toBe("E:/emu/mGBA.exe");
    expect(resolveScriptConfigPath("work/nd", "../../../x")).toBe("../x");
  });
});
