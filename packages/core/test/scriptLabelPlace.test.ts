import { describe, expect, it } from "vitest";
import { ScriptIndex, isScriptLabelReachable, scriptLabelCandidates, scriptLabelPlace } from "../src/index.js";

// #554: ラベルが「ある」のは、マップの .s のラベルか、assembly の中のほかの .s の .global のラベル
const MAP = "assembly/overworld_scripts/03_town.s";
const DEMO = "assembly/overworld_scripts/demo_scripts.s";
const LOCAL = "assembly/overworld_scripts/local.s";

function index(): ScriptIndex {
  const i = new ScriptIndex();
  i.updateFile(MAP, ["Town_Local:", "  end", ".global Town_Global", "Town_Global:", "  end"].join("\n"));
  i.updateFile(DEMO, [".global EventScript_Demo", "EventScript_Demo:", "  end", ".global Shared", "Shared:", "  end"].join("\n"));
  i.updateFile(LOCAL, ["Hidden:", "  end", "Shared:", "  end"].join("\n"));
  i.updateFile("xse_defines.s", [".global RootOnly", "RootOnly:"].join("\n"));
  return i;
}

describe("scriptLabelPlace", () => {
  const own = ["Town_Local", "Town_Global"];

  it("マップの .s のラベルは .global でなくても map", () => {
    expect(scriptLabelPlace("Town_Local", MAP, own, index())).toEqual({ kind: "map" });
  });

  it("ほかの .s の .global のラベルは global（ファイルつき）", () => {
    const p = scriptLabelPlace("EventScript_Demo", MAP, own, index());
    expect(p).toEqual({ kind: "global", path: DEMO });
    expect(isScriptLabelReachable(p)).toBe(true);
  });

  it(".global でないラベルが別のファイルにだけあれば notGlobal", () => {
    const p = scriptLabelPlace("Hidden", MAP, own, index());
    expect(p).toEqual({ kind: "notGlobal", path: LOCAL });
    expect(isScriptLabelReachable(p)).toBe(false);
  });

  it("同じ名前が .global のファイルと、そうでないファイルにあれば global", () => {
    expect(scriptLabelPlace("Shared", MAP, own, index())).toEqual({ kind: "global", path: DEMO });
  });

  it("どこにも無い・assembly の外にしか無いラベルは missing", () => {
    expect(scriptLabelPlace("Nope", MAP, own, index())).toEqual({ kind: "missing" });
    expect(scriptLabelPlace("RootOnly", MAP, own, index())).toEqual({ kind: "missing" });
  });

  it("マップの .s が決まらない（scripts.json が無い）ときも同じ規則", () => {
    expect(scriptLabelPlace("EventScript_Demo", null, [], index())).toEqual({ kind: "global", path: DEMO });
    expect(scriptLabelPlace("Town_Global", null, [], index())).toEqual({ kind: "global", path: MAP });
    expect(scriptLabelPlace("Town_Local", null, [], index())).toEqual({ kind: "notGlobal", path: MAP });
  });

  it("マップの .s の区切りが \\ でも同じファイルとみなす", () => {
    // マップの .s で消したラベル（編集中の本文に無い）は、索引のディスクの分を使わない
    expect(scriptLabelPlace("Town_Global", MAP.replace(/\//g, "\\"), [], index())).toEqual({ kind: "missing" });
  });
});

describe("scriptLabelCandidates", () => {
  it("マップの .s のラベルを先に、ほかの .s の .global を後ろにファイルつきで（名前は 1 回）", () => {
    const list = scriptLabelCandidates(MAP, ["Town_Local", "Town_Global"], index());
    expect(list).toEqual([
      { name: "Town_Local", path: null },
      { name: "Town_Global", path: null },
      { name: "EventScript_Demo", path: DEMO },
      { name: "Shared", path: DEMO },
    ]);
  });

  it("マップの .s が無ければ、.global だけ", () => {
    expect(scriptLabelCandidates(null, [], index()).map((c) => c.name)).toEqual(["Town_Global", "EventScript_Demo", "Shared"]);
  });
});
