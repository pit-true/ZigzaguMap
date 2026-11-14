import { describe, expect, it } from "vitest";
import {
  EVENT_TEMPLATES,
  SIGN_KIND_HIDDEN_ITEM,
  ScriptCommandTable,
  checkTemplateValues,
  checkTextWidth,
  templateDefaults,
  templateFields,
  templateLabelName,
  templateGiveItemLines,
  templateScript,
  type EventTemplateId,
} from "../src/index.js";
import { GIVE_ITEM_MACROS, SETORCOPYVAR } from "./helpers/giveItemMacros.js";

const ND = { dialect: "nd" as const, useGlobal: false };
const CHRONOS = { dialect: "chronos" as const, useGlobal: true };

describe("イベントのひな形", () => {
  it("7 種類があり、既定の文は幅検査（1 行 18 字・2 行）に収まる", () => {
    expect(EVENT_TEMPLATES.map((t) => t.id)).toEqual(["person", "sign", "tile", "hiddenItem", "itemGiver", "mart", "trainer"]);
    for (const t of EVENT_TEMPLATES) for (const x of t.texts) expect(checkTextWidth(x.text).issues, `${t.id}.${x.key}`).toEqual([]);
  });

  it("人・看板・スクリプトタイルは Phase2 のひな形と同じ形（ND は 2 ポインタと _k）", () => {
    expect(templateScript("person", "Moegi_Npc3", templateDefaults("person"), ND)).toEqual({
      label: "Moegi_Npc3",
      asm: ["Moegi_Npc3:", "\tlock", "\tfaceplayer", "\tmsgbox gText_Moegi_Npc3 MSG_FACE gText_Moegi_Npc3_k", "\trelease", "\tend"],
      strings: [
        { label: "gText_Moegi_Npc3", text: "ここに　はなす　ことばを　かきます" },
        { label: "gText_Moegi_Npc3_k", text: "ここに　はなす　ことばを　かきます" },
      ],
    });
    const sign = templateScript("sign", "A_Sign1", templateDefaults("sign"), CHRONOS);
    expect(sign.asm).toEqual([".global A_Sign1", "A_Sign1:", "\tmsgbox gText_A_Sign1 MSG_SIGN", "\tend"]);
    expect(sign.strings.map((s) => s.label)).toEqual(["gText_A_Sign1"]);
    const tile = templateScript("tile", "A_Tile1", { ...templateDefaults("tile"), texts: { text: "かえた　ぶん" } }, CHRONOS);
    expect(tile.asm.slice(2)).toEqual(["\tlockall", "\tmsgbox gText_A_Tile1 MSG_NORMAL", "\treleaseall", "\tend"]);
    expect(tile.strings).toEqual([{ label: "gText_A_Tile1", text: "かえた　ぶん" }]);
  });

  it("アイテムをくれる人: checkflag で済みなら別の文、渡せたら setflag", () => {
    const v = { ...templateDefaults("itemGiver", { flag: 0x230 }), item: 13, amount: 2 };
    const nd = templateScript("itemGiver", "A_Giver1", v, ND);
    expect(nd.asm).toEqual([
      "A_Giver1:",
      "\tlock",
      "\tfaceplayer",
      "\tcheckflag 0x230",
      "\tif 0x1 _goto A_Giver1_After",
      "\tmsgbox gText_A_Giver1 MSG_NORMAL gText_A_Giver1_k",
      "\tsetvarifnotzero 0x8000 0xD",
      "\tsetvarifnotzero 0x8001 0x2",
      "\tcallstd MSG_OBTAIN",
      "\tcompare LASTRESULT 0x0",
      "\tif 0x1 _goto A_Giver1_End",
      "\tsetflag 0x230",
      "\trelease",
      "\tend",
      "",
      "A_Giver1_After:",
      "\tmsgbox gText_A_Giver1_After MSG_NORMAL gText_A_Giver1_After_k",
      "A_Giver1_End:",
      "\trelease",
      "\tend",
    ]);
    expect(nd.strings.map((s) => s.label)).toEqual(["gText_A_Giver1", "gText_A_Giver1_k", "gText_A_Giver1_After", "gText_A_Giver1_After_k"]);
    const ch = templateScript("itemGiver", "A_Giver1", v, CHRONOS);
    expect(ch.asm[0]).toBe(".global A_Giver1");
    expect(ch.asm).toContain("\tmsgbox gText_A_Giver1 MSG_NORMAL");
    expect(ch.strings.map((s) => s.label)).toEqual(["gText_A_Giver1", "gText_A_Giver1_After"]);
  });

  it("アイテムをくれる人: obtainitem が組めるときだけマクロで書く", () => {
    const v = { ...templateDefaults("itemGiver", { flag: 0x230 }), item: 13, amount: 2 };
    const give = (xse: string | null) =>
      templateScript("itemGiver", "A_Giver1", v, { ...ND, commands: xse === null ? null : ScriptCommandTable.build({ xseCommands: xse }) }).asm.slice(6, -11);
    const direct = ["\tsetvarifnotzero 0x8000 0xD", "\tsetvarifnotzero 0x8001 0x2", "\tcallstd MSG_OBTAIN"];
    // 命令表が無いか、setorcopyvar が無くて組めなければ直接書く
    expect(give(null)).toEqual(direct);
    expect(give(GIVE_ITEM_MACROS)).toEqual(direct);
    // setorcopyvar が足されれば、何も変えずに obtainitem になる
    expect(give(GIVE_ITEM_MACROS + SETORCOPYVAR)).toEqual(["\tobtainitem 0xD 0x2"]);
    // obtainitem が無ければ giveitem … MSG_OBTAIN
    const withoutObtain = (GIVE_ITEM_MACROS + SETORCOPYVAR).replace(/\.macro obtainitem[\s\S]*?\.endm\n/, "");
    expect(give(withoutObtain)).toEqual(["\tgiveitem 0xD 0x2 MSG_OBTAIN"]);
    // 引数の数が違う obtainitem は使わない
    expect(templateGiveItemLines(1, 1, ScriptCommandTable.build({ xseCommands: ".macro obtainitem item:req\n.byte 0x1a\n.endm\n" }))).toEqual([
      "\tsetvarifnotzero 0x8000 0x1",
      "\tsetvarifnotzero 0x8001 0x1",
      "\tcallstd MSG_OBTAIN",
    ]);
  });

  it("ショップ: mart と品物の表（.align 1、0 で終わる）", () => {
    const s = templateScript("mart", "A_Mart1", { martItems: [4, 0x11] }, CHRONOS);
    expect(s.asm).toEqual([
      ".global A_Mart1",
      "A_Mart1:",
      "\tlock",
      "\tfaceplayer",
      "\tmart A_Mart1_Mart1",
      "\trelease",
      "\tend",
      "",
      ".align 1",
      "A_Mart1_Mart1:",
      "\t.hword 0x4",
      "\t.hword 0x11",
      "\t.hword 0x0",
    ]);
    expect(s.strings).toEqual([]);
  });

  it("トレーナー: trainer は 1 ポインタ、戦闘後の msgbox は方言どおり。ラベルは EventScript_ で始める", () => {
    const label = templateLabelName("trainer", "Moegi_Trainer1");
    expect(label).toBe("EventScript_Moegi_Trainer1");
    const v = { ...templateDefaults("trainer"), trainerId: 0x15f };
    const nd = templateScript("trainer", label, v, ND);
    expect(nd.asm).toEqual([
      "EventScript_Moegi_Trainer1:",
      "\ttrainer 0x0 0x15F 0x0 gText_Moegi_Trainer1_Intro gText_Moegi_Trainer1_Defeat",
      "\tmsgbox gText_Moegi_Trainer1_After MSG_NORMAL gText_Moegi_Trainer1_After_k",
      "\tend",
    ]);
    expect(nd.strings.map((s) => s.label)).toEqual([
      "gText_Moegi_Trainer1_Intro",
      "gText_Moegi_Trainer1_Defeat",
      "gText_Moegi_Trainer1_After",
      "gText_Moegi_Trainer1_After_k",
    ]);
    expect(templateScript("trainer", label, v, CHRONOS).strings).toHaveLength(3);
    expect(templateFields("trainer", v)).toMatchObject({ trainerType: 1, trainerRangeOrBerryTree: 5, flag: 0 });
  });

  it("落とし物: 看板の隠しアイテム（既定）か、見えるボールの人", () => {
    const v = templateDefaults("hiddenItem", { hiddenId: 9, flag: 0x240 });
    expect(templateFields("hiddenItem", { ...v, item: 3 })).toEqual({ kind: SIGN_KIND_HIDDEN_ITEM, item: 3, flag: 9, amount: 1, underfoot: false });
    expect(templateFields("hiddenItem", { ...v, ball: true })).toEqual({ graphicsId: 92, flag: 0x240 });
    expect(() => templateScript("hiddenItem", "X", v, ND)).toThrow();
  });

  it("入力の確かめ", () => {
    const bad: [EventTemplateId, object][] = [
      ["itemGiver", { flag: 0, item: 1, amount: 1 }],
      ["mart", { martItems: [] }],
      ["trainer", { trainerId: 0, sight: 5 }],
      ["tile", { variable: 0x10000 }],
    ];
    for (const [id, v] of bad) expect(() => checkTemplateValues(id, v), id).toThrow();
    expect(() => checkTemplateValues("itemGiver", templateDefaults("itemGiver", { flag: 0x21 }))).not.toThrow();
  });
});
