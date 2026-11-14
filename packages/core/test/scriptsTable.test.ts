import { describe, expect, it } from "vitest";
import {
  AddScriptsTableEntryCommand,
  CfruProject,
  CommandBus,
  EditError,
  EditErrorCode,
  MemoryProjectFs,
  MoveScriptsTableEntryCommand,
  NEW_SCRIPT_FILE_TEXT,
  RemoveScriptsTableEntryCommand,
  SCRIPTS_JSON_PATH,
  ScriptsJsonFile,
  ScriptsTableProject,
  SetScriptsTableEntryCommand,
  createDefaultRegistry,
  newScriptPath,
  scriptPathProblem,
  withScriptsTable,
  type Command,
  type ScriptsJson,
} from "../src/index.js";
import { roundTrip } from "./helpers/editHarness.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();

const START: ScriptsJson = {
  format: 1,
  entries: [
    { bank: 1, map: null, name: "バンク1", script: "assembly/overworld_scripts/bank01.s", strings: "strings/bank01.string", extra: {} },
    { bank: 1, map: 0, name: "Moegi", script: "assembly/overworld_scripts/01_moegi.s", strings: null, extra: { Memo: "x" } },
  ],
  extra: { Editor: true },
};

/** プロジェクトごとの対応表（roundTrip は開くたびに新しいプロジェクトを作る）。 */
const tables = new WeakMap<CfruProject, ScriptsTableProject>();

async function open(): Promise<CfruProject> {
  const project = await CfruProject.open(rom, new MemoryProjectFs());
  tables.set(project, ScriptsTableProject.of(START, true));
  return project;
}

const contextOf = (p: CfruProject) => withScriptsTable(p.editorContext(), () => tables.get(p)!.document);
const print = (p: CfruProject) => {
  const t = tables.get(p)!;
  return ScriptsJsonFile.stringify(t.document.toJson()) + JSON.stringify(t.pendingFiles());
};

function check(make: () => Command, verify?: (t: ScriptsTableProject) => void): Promise<CfruProject> {
  return roundTrip(open, make, verify ? (p) => verify(tables.get(p)!) : undefined, print, contextOf);
}

const MASARA = { bank: 3, map: 0, name: "マサラタウン", script: "assembly/overworld_scripts/03_00_masara.s", strings: null };

describe("scripts.json の対応表のコマンド", () => {
  it("行を足す（実行・取り消し・やり直し・JSON から再生）", async () => {
    await check(
      () => new AddScriptsTableEntryCommand({ entry: MASARA }),
      (t) => {
        expect(t.document.count).toBe(3);
        expect(t.document.resolve(3, 0)).toMatchObject({ script: MASARA.script, strings: "strings/overworld_strings_03_00_masara.string" });
        expect(t.pendingFiles()).toEqual([]);
      },
    );
  });

  it("新しく作る行を足すと、出力で作るファイルに入る", async () => {
    await check(
      () => new AddScriptsTableEntryCommand({ entry: MASARA, index: 0, create: true }),
      (t) => {
        expect(t.document.rows[0]!.create).toBe(true);
        expect(t.pendingFiles()).toEqual([{ script: MASARA.script, strings: "strings/overworld_strings_03_00_masara.string" }]);
        expect(t.isModified()).toBe(true);
      },
    );
  });

  it("行を書き換える（知らない項目は残す。区切りの \\ は / にする）", async () => {
    await check(
      () =>
        new SetScriptsTableEntryCommand({
          index: 1,
          entry: { bank: 1, map: 2, name: "Moegi2", script: "assembly\\overworld_scripts\\01_moegi.s", strings: "strings/moegi.string" },
        }),
      (t) => {
        expect(t.document.rows[1]!.entry).toEqual({
          bank: 1,
          map: 2,
          name: "Moegi2",
          script: "assembly/overworld_scripts/01_moegi.s",
          strings: "strings/moegi.string",
          extra: { Memo: "x" },
        });
      },
    );
  });

  it("行を消す・動かす", async () => {
    await check(
      () => new RemoveScriptsTableEntryCommand({ index: 0 }),
      (t) => expect(t.document.rows.map((r) => r.entry.name)).toEqual(["Moegi"]),
    );
    await check(
      () => new MoveScriptsTableEntryCommand({ index: 1, to: 0 }),
      (t) => expect(t.document.rows.map((r) => r.entry.name)).toEqual(["Moegi", "バンク1"]),
    );
  });

  it("入力の誤りは EditError で、何も変わらない", async () => {
    const project = await open();
    const t = tables.get(project)!;
    const bus = new CommandBus(contextOf(project));
    const before = print(project);
    const cases: [Command, string][] = [
      [new AddScriptsTableEntryCommand({ entry: { ...MASARA, bank: 256 } }), EditErrorCode.ValueOutOfRange],
      [new AddScriptsTableEntryCommand({ entry: { ...MASARA, script: "" } }), EditErrorCode.InvalidScriptPath],
      [new AddScriptsTableEntryCommand({ entry: { ...MASARA, script: "../x.s" } }), EditErrorCode.InvalidScriptPath],
      [new AddScriptsTableEntryCommand({ entry: { ...MASARA, script: "C:/x.s" } }), EditErrorCode.InvalidScriptPath],
      [new AddScriptsTableEntryCommand({ entry: { ...MASARA, strings: "strings/a.txt" } }), EditErrorCode.InvalidScriptPath],
      [new AddScriptsTableEntryCommand({ entry: { ...MASARA, script: "src/a.s" }, create: true }), EditErrorCode.InvalidScriptPath],
      [new AddScriptsTableEntryCommand({ entry: { ...MASARA, script: "assembly/overworld_scripts/まさら.s" }, create: true }), EditErrorCode.InvalidScriptPath],
      [new AddScriptsTableEntryCommand({ entry: MASARA, index: 5 }), EditErrorCode.ScriptsTableIndexOutOfRange],
      [new SetScriptsTableEntryCommand({ index: 2, entry: MASARA }), EditErrorCode.ScriptsTableIndexOutOfRange],
      [new RemoveScriptsTableEntryCommand({ index: -1 }), EditErrorCode.ScriptsTableIndexOutOfRange],
      [new MoveScriptsTableEntryCommand({ index: 0, to: 2 }), EditErrorCode.ScriptsTableIndexOutOfRange],
    ];
    for (const [command, code] of cases) {
      let error: unknown = null;
      try {
        bus.execute(command);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(EditError);
      expect((error as EditError).code).toBe(code);
    }
    expect(print(project)).toBe(before);
    expect(bus.canUndo).toBe(false);
    expect(t.isModified()).toBe(false);
  });

  it("登録表から作れる", () => {
    const names = createDefaultRegistry().names();
    for (const n of ["addScriptsTableEntry", "setScriptsTableEntry", "removeScriptsTableEntry", "moveScriptsTableEntry"]) expect(names).toContain(n);
    const c = createDefaultRegistry().create({ name: "addScriptsTableEntry", args: { entry: { bank: 2, script: "assembly/overworld_scripts/b.s" } } });
    expect(c.args).toEqual({ entry: { bank: 2, map: null, name: "", script: "assembly/overworld_scripts/b.s", strings: null } });
  });

  it("パスの確かめ方とファイル名からのパス", () => {
    expect(newScriptPath("03_00_masara")).toBe("assembly/overworld_scripts/03_00_masara.s");
    expect(newScriptPath(" 03_00_masara.s ")).toBe("assembly/overworld_scripts/03_00_masara.s");
    expect(scriptPathProblem("script", "assembly/overworld_scripts/a.s", true)).toBeNull();
    expect(scriptPathProblem("script", "assembly/overworld_scripts/sub/a.s", true)).toBe("folder");
    expect(scriptPathProblem("script", "assembly/overworld_scripts/a b.s", true)).toBe("chars");
    expect(scriptPathProblem("script", "a//b.s")).toBe("parent");
    expect(scriptPathProblem("script", ".s")).toBe("extension");
    expect(scriptPathProblem("strings", "strings/x.string", true)).toBeNull();
  });
});

describe("scripts.json の対応表の出力", () => {
  it("無ければ空の表。変えなければ何も書かない", async () => {
    const fs = new MemoryProjectFs();
    const t = await ScriptsTableProject.open(fs);
    expect(t.document.count).toBe(0);
    expect(t.isModified()).toBe(false);
    expect(await t.save(fs)).toEqual({ written: [], removed: [] });
    expect(fs.files.size).toBe(0);
  });

  it("手で書いた整形は、表を変えなければそのまま残す", async () => {
    const fs = new MemoryProjectFs();
    const text = '{"Format":1,"Entries":[{"Bank":1,"Script":"assembly/overworld_scripts/a.s"}]}';
    fs.files.set(SCRIPTS_JSON_PATH, text);
    const t = await ScriptsTableProject.open(fs);
    expect(t.document.count).toBe(1);
    expect((await t.save(fs)).written).toEqual([]);
    expect(fs.files.get(SCRIPTS_JSON_PATH)).toBe(text);
  });

  it("読めない scripts.json は編集も上書きもしない", async () => {
    const fs = new MemoryProjectFs();
    fs.files.set(SCRIPTS_JSON_PATH, "{ broken");
    const t = await ScriptsTableProject.open(fs);
    expect(t.loadError).not.toBeNull();
    expect((await t.save(fs)).written).toEqual([]);
    expect(fs.files.get(SCRIPTS_JSON_PATH)).toBe("{ broken");
  });

  it("出力すると scripts.json・.s・.string を書き、読み直すと同じ表になる", async () => {
    const fs = new MemoryProjectFs();
    fs.files.set("strings/overworld_strings_keep.string", "#org @x\nkeep\n");
    const t = await ScriptsTableProject.open(fs);
    const ctx = withScriptsTable(new CfruProjectStub(), () => t.document);
    const bus = new CommandBus(ctx);
    bus.execute(new AddScriptsTableEntryCommand({ entry: MASARA, create: true }));
    bus.execute(new AddScriptsTableEntryCommand({ entry: { bank: 4, map: null, name: "", script: "assembly/overworld_scripts/keep.s", strings: null }, create: true }));
    bus.execute(new AddScriptsTableEntryCommand({ entry: { bank: 5, map: 1, name: "既存", script: "assembly/overworld_scripts/01_moegi.s", strings: null } }));
    expect(t.isModified()).toBe(true);
    const result = await t.save(fs);
    expect(result.written).toEqual([
      MASARA.script,
      "strings/overworld_strings_03_00_masara.string",
      "assembly/overworld_scripts/keep.s",
      SCRIPTS_JSON_PATH,
    ]);
    expect(fs.files.get(MASARA.script)).toBe(NEW_SCRIPT_FILE_TEXT);
    expect(NEW_SCRIPT_FILE_TEXT.startsWith('.text\n.thumb\n.align 2\n\n.include "../xse_commands.s"\n.include "../xse_defines.s"\n.include "../asm_defines.s"\n')).toBe(true);
    expect(fs.files.get("strings/overworld_strings_03_00_masara.string")).toBe("");
    // 既にある .string は書き換えない
    expect(fs.files.get("strings/overworld_strings_keep.string")).toBe("#org @x\nkeep\n");
    expect(fs.files.has("assembly/overworld_scripts/01_moegi.s")).toBe(false);
    expect(t.isModified()).toBe(false);
    // 2 回目は何も書かない（作ったファイルを上書きしない）
    fs.files.set(MASARA.script, "edited");
    expect((await t.save(fs)).written).toEqual([]);
    expect(fs.files.get(MASARA.script)).toBe("edited");

    const again = await ScriptsTableProject.open(fs);
    expect(again.document.toJson()).toEqual(t.document.toJson());
    expect(again.document.rows.every((r) => !r.create)).toBe(true);
  });

  it("新しく作る行を取り消せば、ファイルは作らない", async () => {
    const fs = new MemoryProjectFs();
    const t = await ScriptsTableProject.open(fs);
    const bus = new CommandBus(withScriptsTable(new CfruProjectStub(), () => t.document));
    bus.execute(new AddScriptsTableEntryCommand({ entry: MASARA, create: true }));
    bus.undo();
    expect(t.isModified()).toBe(false);
    expect((await t.save(fs)).written).toEqual([]);
    expect(fs.files.size).toBe(0);
  });
});

/** 配置を持たない入口（対応表のコマンドは grid を使わない）。 */
class CfruProjectStub {
  grid(): never {
    throw new Error("使わない");
  }
}
