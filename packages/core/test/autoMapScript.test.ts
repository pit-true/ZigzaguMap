import { describe, expect, it } from "vitest";
import { ScriptIndex, autoMapScript, autoMapScriptCandidates } from "../src/index.js";

// #562: 紐づけが無いとき、マップのラベルが定義されている .s を「このマップの .s」にする
const TOWN = "assembly/overworld_scripts/town.s";
const DEMO = "assembly/overworld_scripts/demo.s";
const SYSTEM = "assembly/overworld_scripts/system_scripts.s";
const SHARED = "assembly/overworld_scripts/shared.s";

function file(globals: string[], locals: string[] = []): string {
  return [...globals.flatMap((n) => [`.global ${n}`, `${n}:`, "  end"]), ...locals.flatMap((n) => [`${n}:`, "  end"])].join("\n");
}

function index(): ScriptIndex {
  const i = new ScriptIndex();
  i.updateFile(TOWN, file(["Town_Npc1", "Town_Npc2", "Town_Sign1"], ["Town_Npc1_Sub"]));
  i.updateFile(DEMO, file(["Demo_Npc"], ["Demo_Sub"]));
  i.updateFile(SYSTEM, file(["Sys_A", "Sys_B", "Sys_C", "Sys_D", "Sys_E"]));
  i.updateFile(SHARED, file(["Other_1", "Other_2", "Mine_1"]));
  i.updateFile("xse_defines.s", file(["Town_Npc2"]));
  return i;
}

describe("autoMapScript", () => {
  it("マップのラベルがいちばん多い .s にする", () => {
    expect(autoMapScript(["Town_Npc1", "Town_Npc2", "Demo_Npc"], index(), new Set())).toEqual({ path: TOWN, labels: ["Town_Npc1", "Town_Npc2"] });
  });

  it("ラベルが 1 つでも、そのファイルの .global の 4 分の 1 以上がこのマップのものなら選ぶ", () => {
    expect(autoMapScript(["Demo_Npc"], index(), new Set())?.path).toBe(DEMO);
  });

  it("共用のファイル（.global の 4 分の 3 より多くがほかの入口）は選ばない", () => {
    expect(autoMapScript(["Sys_A"], index(), new Set())).toBeNull();
    expect(autoMapScript(["Sys_A", "Demo_Npc"], index(), new Set())?.path).toBe(DEMO);
    const c = autoMapScriptCandidates(["Sys_A"], index(), new Set());
    expect(c).toEqual([{ path: SYSTEM, own: 1, others: 0, globals: 5, shared: true }]);
  });

  it("ほかのマップのラベルのほうが多いファイルは選ばない", () => {
    expect(autoMapScript(["Mine_1"], index(), new Set())?.path).toBe(SHARED);
    expect(autoMapScript(["Mine_1"], index(), new Set(["Other_2", "Other_1"]))).toBeNull();
  });

  it("同じ数のファイルが 2 つ以上なら決めない。ラベルが無い・見つからないときも決めない", () => {
    expect(autoMapScript(["Town_Npc1", "Demo_Npc"], index(), new Set())).toBeNull();
    expect(autoMapScript(["Town_Npc1"], index(), new Set())?.path).toBe(TOWN);
    expect(autoMapScript([], index(), new Set())).toBeNull();
    expect(autoMapScript(["Nope"], index(), new Set())).toBeNull();
  });
});
