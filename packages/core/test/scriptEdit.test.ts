import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRIPT_LABEL_TEMPLATE,
  appendBlock,
  asmBlockText,
  detectLabelRename,
  emptyScriptTemplate,
  eventScriptTemplate,
  findLabelOccurrences,
  isScriptLabelName,
  mapScriptTableFromEntries,
  mapScriptTargetLabel,
  mapScriptTypeOfAddress,
  newScriptLabel,
  parseMapScriptTable,
  removeBlock,
  renameLabelInText,
  replaceMapScriptTable,
  retargetMapScriptAddress,
  scriptLabelMapName,
  stringsBlockText,
  textNewline,
  type MapScriptTableModel,
} from "../src/index.js";

describe("ラベルの自動命名", () => {
  it(".s の名前からマップの名前を作る", () => {
    expect(scriptLabelMapName("assembly/overworld_scripts/01_moegi.s", 1, 0)).toBe("Moegi");
    expect(scriptLabelMapName("assembly/overworld_scripts/pallet_town_demo_scripts.s", 3, 0)).toBe("PalletTownDemo");
    expect(scriptLabelMapName("assembly/overworld_scripts/03_00.s", 3, 0)).toBe("Map3_0");
    expect(scriptLabelMapName("assembly/overworld_scripts/scripts.s", 3, 0)).toBe("Map3_0");
    expect(scriptLabelMapName(null, 3, 19)).toBe("Map3_19");
  });

  it("規則を埋め、重なれば番号を増やす", () => {
    const taken = new Set(["Moegi_Npc3", "Moegi_Npc4"]);
    expect(DEFAULT_SCRIPT_LABEL_TEMPLATE).toBe("{map}_{kind}{index}");
    expect(newScriptLabel(DEFAULT_SCRIPT_LABEL_TEMPLATE, { map: "Moegi", kind: "person", index: 3 }, (n) => taken.has(n))).toBe("Moegi_Npc5");
    expect(newScriptLabel(DEFAULT_SCRIPT_LABEL_TEMPLATE, { map: "Moegi", kind: "sign", index: 1 }, () => false)).toBe("Moegi_Sign1");
    expect(newScriptLabel(DEFAULT_SCRIPT_LABEL_TEMPLATE, { map: "Map3_0", kind: "tile", index: 2 }, () => false)).toBe("Map3_0_Tile2");
    expect(newScriptLabel(DEFAULT_SCRIPT_LABEL_TEMPLATE, { map: "Moegi", kind: "map", index: 0 }, () => false)).toBe("Moegi_MapScripts");
    expect(newScriptLabel(DEFAULT_SCRIPT_LABEL_TEMPLATE, { map: "Moegi", kind: "map", index: 0 }, (n) => n === "Moegi_MapScripts")).toBe("Moegi_MapScripts2");
    expect(isScriptLabelName("Moegi_Npc3")).toBe(true);
    expect(isScriptLabelName("3abc")).toBe(false);
    expect(isScriptLabelName("萌黄")).toBe(false);
  });
});

describe("ひな形", () => {
  it("ND は 0F を 2 ポインタで書き、.string に漢字も足す", () => {
    const t = eventScriptTemplate("person", "Moegi_Npc3", { dialect: "nd", useGlobal: false });
    expect(t.asm).toEqual(["Moegi_Npc3:", "\tlock", "\tfaceplayer", "\tmsgbox gText_Moegi_Npc3 MSG_FACE gText_Moegi_Npc3_k", "\trelease", "\tend"]);
    expect(t.strings.map((s) => s.label)).toEqual(["gText_Moegi_Npc3", "gText_Moegi_Npc3_k"]);
  });

  it("Chronos は 1 ポインタで、.global を付ける", () => {
    const sign = eventScriptTemplate("sign", "Moegi_Sign1", { dialect: "chronos", useGlobal: true });
    expect(sign.asm).toEqual([".global Moegi_Sign1", "Moegi_Sign1:", "\tmsgbox gText_Moegi_Sign1 MSG_SIGN", "\tend"]);
    expect(sign.strings).toHaveLength(1);
    const tile = eventScriptTemplate("tile", "Moegi_Tile2", { dialect: "chronos", useGlobal: false });
    expect(tile.asm).toEqual(["Moegi_Tile2:", "\tlockall", "\tmsgbox gText_Moegi_Tile2 MSG_NORMAL", "\treleaseall", "\tend"]);
    expect(emptyScriptTemplate("X", { dialect: "nd", useGlobal: false }, { variable: 0x4050, value: 1 }).asm).toEqual(["X:", "\tsetvar 0x4050 0x1", "\tend"]);
  });

  it("足したまとまりは、手を入れていなければ除ける", () => {
    const text = ".text\n.thumb\n";
    const block = asmBlockText(["A:", "\tend"], textNewline(text));
    const { text: after, added } = appendBlock(text, block);
    expect(after).toBe(".text\n.thumb\n\nA:\n\tend\n");
    expect(removeBlock(after, added)).toBe(text);
    expect(removeBlock(after.replace("\tend", "\treturn"), added)).toBeNull();
    // 最後に改行が無いファイル
    expect(appendBlock("x", block).text).toBe("x\n\nA:\n\tend\n");
    // CRLF のファイル
    const crlf = "a\r\nb\r\n";
    expect(appendBlock(crlf, asmBlockText(["A:"], textNewline(crlf))).text).toBe("a\r\nb\r\n\r\nA:\r\n");
    expect(stringsBlockText([{ label: "gText_A", text: "あ" }], "\n")).toBe("\n#org @gText_A\nあ\n");
  });
});

describe("ラベル名の変更", () => {
  const src = [
    "EventScript_A:",
    '\tmsgbox gText_A MSG_FACE @ EventScript_A はコメント',
    "\tgoto EventScript_A",
    '\t.string "EventScript_A"',
    "/* EventScript_A */ EventScript_AB:",
    "\tcall EventScript_A",
  ].join("\n");

  it("コメントと文字列の中は変えない", () => {
    const hits = findLabelOccurrences(src, "EventScript_A");
    expect(hits.map((h) => h.definition)).toEqual([true, false, false]);
    const out = renameLabelInText(src, "EventScript_A", "EventScript_Z");
    expect(out.count).toBe(3);
    expect(out.text).toContain("EventScript_Z:\n");
    expect(out.text).toContain("@ EventScript_A はコメント");
    expect(out.text).toContain('"EventScript_A"');
    expect(out.text).toContain("EventScript_AB:");
    expect(out.text).toContain("\tcall EventScript_Z");
  });

  it("消えたラベルと増えたラベルが 1 つずつなら変更とみなす", () => {
    expect(detectLabelRename(["A", "B"], ["A", "C"])).toEqual({ from: "B", to: "C" });
    expect(detectLabelRename(["A", "B"], ["A"])).toBeNull();
    expect(detectLabelRename(["A", "B"], ["C", "D"])).toBeNull();
  });
});

describe("マップスクリプトの表", () => {
  const table: MapScriptTableModel = {
    label: "Moegi_MapScripts",
    items: [
      { type: 3, script: "Moegi_OnTransition", conditions: [] },
      { type: 2, script: "", conditions: [{ variable: 0x4050, value: 0, script: "Moegi_Frame0" }] },
    ],
  };

  it("書いて読み直すと同じ表になる", () => {
    const text = replaceMapScriptTable(".text\n", "Moegi_MapScripts", table, false);
    expect(text).toContain("\tmapscript MAP_SCRIPT_ON_TRANSITION Moegi_OnTransition\n");
    expect(text).toContain("\tmapscript MAP_SCRIPT_ON_FRAME_TABLE Moegi_MapScripts_FrameTable\n");
    expect(text).toContain("\tlevelscript 0x4050 0x0 Moegi_Frame0\n\t.hword 0\n");
    expect(parseMapScriptTable(text.split("\n"), "Moegi_MapScripts")).toEqual(table);
    // 書き換えと消す
    const next = replaceMapScriptTable(text, "Moegi_MapScripts", { label: "Moegi_MapScripts", items: [table.items[0]!] }, true);
    expect(next).toContain(".global Moegi_MapScripts\n");
    expect(next).not.toContain("levelscript");
    expect(replaceMapScriptTable(next, "Moegi_MapScripts", null, true)).toBe(".text\n");
  });
});

describe("マップスクリプトの行き先の取り込み", () => {
  const table = mapScriptTableFromEntries("Moegi_MapScripts", [
    { type: 3, pointer: 0x0816f58d, table: null },
    { type: 2, pointer: 0x08170000, table: { entries: [{ variable: 0x4050, value: 0, script: 0x0816f58d }, { variable: 0x4050, value: 1, script: 0x08170100 }], tail: new Uint8Array(8) } },
    { type: 0x0f, pointer: 0x08000000, table: null },
  ]);

  it("ROM のマップスクリプトをアドレスのまま表にする", () => {
    expect(table).toEqual({
      label: "Moegi_MapScripts",
      items: [
        { type: 3, script: "0x0816F58D", conditions: [] },
        {
          type: 2,
          script: "",
          conditions: [
            { variable: 0x4050, value: 0, script: "0x0816F58D" },
            { variable: 0x4050, value: 1, script: "0x08170100" },
          ],
        },
      ],
    });
  });

  it("行き先のアドレスの種類を探し、同じアドレスの行き先をすべて付け替える", () => {
    expect(mapScriptTypeOfAddress(table, 0x0816f58d)).toBe(3);
    expect(mapScriptTypeOfAddress(table, 0x08170100)).toBe(2);
    expect(mapScriptTypeOfAddress(table, 0x08170000)).toBeNull();
    const next = retargetMapScriptAddress(table, 0x0816f58d, "Moegi_MapScripts_OnTransition");
    expect(next.items[0]!.script).toBe("Moegi_MapScripts_OnTransition");
    expect(next.items[1]!.conditions.map((c) => c.script)).toEqual(["Moegi_MapScripts_OnTransition", "0x08170100"]);
    expect(retargetMapScriptAddress({ label: "T", items: [{ type: 1, script: "0x816f58d", conditions: [] }] }, 0x0816f58d, "X").items[0]!.script).toBe("X");
  });

  it("行き先のラベルは <表のラベル>_<種類> で、重なれば 2 から番号を付ける", () => {
    expect(mapScriptTargetLabel("Moegi_MapScripts", 2, () => false)).toBe("Moegi_MapScripts_OnFrame");
    const taken = new Set(["Moegi_MapScripts_OnLoad", "Moegi_MapScripts_OnLoad2"]);
    expect(mapScriptTargetLabel("Moegi_MapScripts", 1, (n) => taken.has(n))).toBe("Moegi_MapScripts_OnLoad3");
  });
});
