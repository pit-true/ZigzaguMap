import { describe, expect, it } from "vitest";
import {
  AddScriptsTableEntryCommand,
  RemoveScriptsTableEntryCommand,
  ScriptsJsonFile,
  ScriptsTableDocument,
  SetScriptsTableEntryCommand,
  mapScriptLinkEntry,
  mapScriptLinkPath,
  mapScriptLinkState,
  withScriptsTable,
  type EditorContext,
} from "../src/index.js";

// #555: 場所の設定タブで、マップに紐づける .s を選ぶ
const ROOT = "C:\\Users\\me\\Chronos\\cfru";

describe("mapScriptLinkPath", () => {
  it("プロジェクトの assembly の中の .s は、相対パスにする", () => {
    expect(mapScriptLinkPath(ROOT, `${ROOT}\\assembly\\overworld_scripts\\demo.s`)).toEqual({ path: "assembly/overworld_scripts/demo.s" });
    expect(mapScriptLinkPath(ROOT, "c:/users/me/chronos/cfru/Assembly/x.s")).toEqual({ path: "assembly/x.s" });
    expect(mapScriptLinkPath(ROOT, "assembly/overworld_scripts/a.s")).toEqual({ path: "assembly/overworld_scripts/a.s" });
  });

  it("assembly の外・プロジェクトの外・.s でないファイルは断る", () => {
    expect(mapScriptLinkPath(ROOT, `${ROOT}\\xse_commands.s`)).toEqual({ problem: "outside" });
    expect(mapScriptLinkPath(ROOT, `${ROOT}2\\assembly\\a.s`)).toEqual({ problem: "outside" });
    expect(mapScriptLinkPath(ROOT, "D:\\other\\assembly\\a.s")).toEqual({ problem: "outside" });
    expect(mapScriptLinkPath(ROOT, "assembly/../xse_defines.s")).toEqual({ problem: "outside" });
    expect(mapScriptLinkPath(ROOT, `${ROOT}\\assembly\\a.string`)).toEqual({ problem: "extension" });
  });
});

function table(json: string): { doc: ScriptsTableDocument; ctx: EditorContext } {
  const doc = new ScriptsTableDocument(ScriptsJsonFile.parse(json));
  return { doc, ctx: withScriptsTable({} as EditorContext, () => doc) };
}

const BANK_ONLY = JSON.stringify({ Format: 1, Entries: [{ Bank: 3, Name: "町", Script: "assembly/overworld_scripts/towns.s", Strings: "strings/towns.string" }] });

describe("mapScriptLinkState と mapScriptLinkEntry", () => {
  it("紐づけが無いときは none、バンクの行だけなら bank", () => {
    expect(mapScriptLinkState(table(JSON.stringify({ Format: 1, Entries: [] })).doc, 3, 1)).toEqual({ script: null, from: "none", row: -1 });
    expect(mapScriptLinkState(table(BANK_ONLY).doc, 3, 1)).toEqual({ script: "assembly/overworld_scripts/towns.s", from: "bank", row: -1 });
  });

  it("マップの行を足すとバンクの行より優先し、元に戻すと消える。外すとバンクの行に戻る", () => {
    const { doc, ctx } = table(BANK_ONLY);
    const add = new AddScriptsTableEntryCommand({ entry: mapScriptLinkEntry(doc, 3, 1, "assembly/overworld_scripts/demo.s", "トキワシティ") });
    add.do(ctx);
    expect(mapScriptLinkState(doc, 3, 1)).toEqual({ script: "assembly/overworld_scripts/demo.s", from: "map", row: 1 });
    expect(mapScriptLinkState(doc, 3, 0).from).toBe("bank");
    expect(doc.rows[1]!.entry).toMatchObject({ bank: 3, map: 1, name: "トキワシティ", strings: null });
    add.undo(ctx);
    expect(mapScriptLinkState(doc, 3, 1).from).toBe("bank");
    add.do(ctx);
    new RemoveScriptsTableEntryCommand({ index: mapScriptLinkState(doc, 3, 1).row }).do(ctx);
    expect(mapScriptLinkState(doc, 3, 1)).toEqual({ script: "assembly/overworld_scripts/towns.s", from: "bank", row: -1 });
  });

  it("マップの行があれば書き換える（.s が同じなら .string と名前はそのまま）", () => {
    const { doc, ctx } = table(
      JSON.stringify({ Format: 1, Entries: [{ Bank: 3, Map: 1, Name: "前", Script: "assembly/a.s", Strings: "strings/a.string" }] }),
    );
    expect(mapScriptLinkEntry(doc, 3, 1, "assembly/a.s", "新")).toEqual({ bank: 3, map: 1, name: "前", script: "assembly/a.s", strings: "strings/a.string" });
    const entry = mapScriptLinkEntry(doc, 3, 1, "assembly/b.s", "新");
    expect(entry).toEqual({ bank: 3, map: 1, name: "前", script: "assembly/b.s", strings: null });
    new SetScriptsTableEntryCommand({ index: 0, entry }).do(ctx);
    expect(ScriptsJsonFile.stringify(doc.toJson())).toContain('"Script": "assembly/b.s"');
  });
});
