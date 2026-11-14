import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EventScriptsEditError,
  EventScriptsFile,
  MemoryProjectFs,
  eventScriptLabel,
  eventScriptSymbolFor,
  isEventScriptEntryActive,
  loadEventScripts,
  parseEventScriptAddress,
  parseEventScriptDefines,
  saveEventScripts,
} from "../src/index.js";

/** 手書きの見本（LF、最後の行に改行なし）。 */
const SAMPLE = readFileSync(new URL("./fixtures/script/project/eventscripts", import.meta.url), "utf8");

/** 1 番道路（バンク 3・マップ 19）の人の項目を [番号, シンボル] で並べる。 */
function persons(file: EventScriptsFile, bank = 3, map = 19): [number | null, string][] {
  return file.entriesFor(bank, map, "person").map((e) => [e.index, e.symbol]);
}

describe("eventscripts の読み書き", () => {
  it("LF・CRLF・CR・混在の改行と BOM を 1 バイトも変えずに書き戻す", () => {
    const variants = [
      SAMPLE,
      SAMPLE.replace(/\n/g, "\r\n"),
      SAMPLE.replace(/\n/g, "\r"),
      SAMPLE.split("\n").map((l, i) => l + (i % 2 ? "\r\n" : "\n")).join(""),
      "﻿" + SAMPLE + "\n\n",
      "",
      "##",
      "\n",
    ];
    for (const text of variants) expect(EventScriptsFile.parse(text).stringify()).toBe(text);
  });

  it("行の種類を insert.py と同じに見分ける", () => {
    const file = EventScriptsFile.parse(SAMPLE);
    const types = file.lines().map((l) => l.type);
    expect(types).toEqual([
      "comment", "include", "blank", "comment",
      "entry", "entry", "entry", "entry", "entry", "entry", "entry", "entry",
      "blank", "conditional", "entry", "conditional", "entry", "conditional", "blank",
      "comment", "comment", "unknown", "unknown", "entry", "entry",
    ]);
    expect(file.includes()).toEqual(["src/config.h"]);
    expect(file.newline).toBe("\n");
    expect(EventScriptsFile.parse("a\r\nb\n").newline).toBe("\r\n");
  });

  it("項目の種別・バンク・マップ・番号・シンボル・行番号・条件", () => {
    const file = EventScriptsFile.parse(SAMPLE);
    const [map, , npc1, trainer] = file.entries();
    expect(map).toMatchObject({ line: 5, kind: "map", bank: 3, map: 19, index: null, symbol: "MapScript_Route1", conditions: [] });
    expect(npc1).toMatchObject({ line: 7, kind: "npc", index: 1, symbol: "EventScript_Route1_Npc1" });
    expect(trainer).toMatchObject({ kind: "trainer", index: 2, symbol: "Route1_Trainer" });
    const debug = file.entriesFor(3, 19, "person", 5);
    expect(debug.map((e) => [e.symbol, e.conditions])).toEqual([
      ["EventScript_Route1_Debug", [{ name: "DEBUG_MENU", defined: true }]],
      ["EventScript_Route1_Release", [{ name: "DEBUG_MENU", defined: false }]],
    ]);
    const on = new Map<string, string | true>([["DEBUG_MENU", true]]);
    expect(debug.map((e) => isEventScriptEntryActive(e, on))).toEqual([true, false]);
    expect(debug.map((e) => isEventScriptEntryActive(e, new Map()))).toEqual([false, true]);
    expect(file.entriesFor(3, 19, "sign")).toHaveLength(1);
    expect(file.entriesFor(3, 19, "tile")).toHaveLength(1);
    expect(file.entriesFor(1, 0)).toHaveLength(2);
  });

  it("trainer と item のラベル名には頭の文字列が付く", () => {
    expect(eventScriptLabel("trainer", "Route1_Trainer")).toBe("EventScript_Route1_Trainer");
    expect(eventScriptLabel("item", "Route1_Potion")).toBe("ItemFindScript_Route1_Potion");
    expect(eventScriptLabel("npc", "EventScript_A")).toBe("EventScript_A");
    expect(eventScriptLabel("npc", "ALIAS", new Map([["ALIAS", "EventScript_Real"]]))).toBe("EventScript_Real");
    expect(eventScriptLabel("npc", "FLAG", new Map([["FLAG", true]]))).toBe("FLAG");
    expect(eventScriptSymbolFor("trainer", "EventScript_Route1_Trainer")).toBe("Route1_Trainer");
    expect(eventScriptSymbolFor("item", "EventScript_X")).toBeNull();
    expect(eventScriptSymbolFor("sign", "EventScript_X")).toBe("EventScript_X");
    expect(parseEventScriptAddress("0x8800000")).toBe(0x8800000);
    expect(parseEventScriptAddress("EventScript_X")).toBeNull();
  });

  it("#include 先の #define を insert.py と同じに読む", () => {
    const defines = parseEventScriptDefines("#define DEBUG_MENU\n#define VALUE 0x10 // c\n#define NOTE //c\n  #define INDENTED\r\n#define X /* y */\n");
    expect([...defines]).toEqual([["DEBUG_MENU", true], ["VALUE", "0x10"], ["NOTE", true], ["X", true]]);
  });
});

describe("eventscripts の編集", () => {
  it("人を 1 人消すと、後ろの npc の番号が 1 つずつ減り、消した人の行が消える", () => {
    const file = EventScriptsFile.parse(SAMPLE);
    const result = file.removeEvent(3, 19, "person", 1);
    expect(result.removed.map((e) => e.symbol)).toEqual(["EventScript_Route1_Npc1"]);
    expect(persons(file)).toEqual([
      [0, "EventScript_Route1_Npc0"],
      [1, "Route1_Trainer"],
      [2, "Route1_Potion"],
      [3, "EventScript_Route1_Npc4"],
      [4, "EventScript_Route1_Debug"],
      [4, "EventScript_Route1_Release"],
    ]);
    // 変わったのは消した行と番号の部分だけ（桁をそろえた 05 は 04 になる）。
    const expected = SAMPLE.replace("NPC\t3  19   1   EventScript_Route1_Npc1\n", "")
      .replace("trainer 3 19 2 ", "trainer 3 19 1 ")
      .replace("item 3 19 3 ", "item 3 19 2 ")
      .replace("npc 3 19 4 ", "npc 3 19 3 ")
      .replace("npc 3 19 05 EventScript_Route1_Debug", "npc 3 19 04 EventScript_Route1_Debug")
      .replace("npc 3 19 05 EventScript_Route1_Release", "npc 3 19 04 EventScript_Route1_Release");
    expect(file.stringify()).toBe(expected);
    expect(result.changed.map((e) => e.line)).toEqual([7, 8, 9, 14, 16]);
    // 他のマップ・他の並び（看板）は変わらない。
    expect(file.entriesFor(1, 0, "person")[0]!.index).toBe(2);
    expect(file.entriesFor(3, 19, "sign")[0]!.index).toBe(0);
  });

  it("CRLF のファイルでも消した行の改行ごと消し、他の行の改行は変えない", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    const file = EventScriptsFile.parse(crlf);
    file.removeEvent(3, 19, "person", 0);
    expect(file.stringify()).toBe(
      crlf
        .replace("npc 3 19 0 EventScript_Route1_Npc0\r\n", "")
        .replace("NPC\t3  19   1   ", "NPC\t3  19   0   ")
        .replace("trainer 3 19 2 ", "trainer 3 19 1 ")
        .replace("item 3 19 3 ", "item 3 19 2 ")
        .replace("npc 3 19 4 ", "npc 3 19 3 ")
        .replace(/npc 3 19 05 /g, "npc 3 19 04 "),
    );
  });

  it("入れ替えと移動で番号を付け直す", () => {
    const swapped = EventScriptsFile.parse(SAMPLE);
    swapped.swapEvents(3, 19, "person", 0, 2);
    expect(persons(swapped).slice(0, 3)).toEqual([
      [2, "EventScript_Route1_Npc0"],
      [1, "EventScript_Route1_Npc1"],
      [0, "Route1_Trainer"],
    ]);
    const moved = EventScriptsFile.parse(SAMPLE);
    moved.moveEvent(3, 19, "person", 0, 3);
    expect(persons(moved).map(([i]) => i)).toEqual([3, 0, 1, 2, 4, 5, 5]);
    moved.moveEvent(3, 19, "person", 3, 0);
    expect(moved.stringify()).toBe(SAMPLE);
  });

  it("看板とスクリプトタイルは人とは別の並び", () => {
    const file = EventScriptsFile.parse(SAMPLE);
    file.removeEvent(3, 19, "sign", 0);
    expect(file.entriesFor(3, 19, "sign")).toEqual([]);
    expect(persons(file)).toHaveLength(7);
    expect(file.entriesFor(3, 19, "tile")).toHaveLength(1);
  });

  it("足す行は同じマップの条件なしの最後の項目の次、無ければ末尾に入る", () => {
    const file = EventScriptsFile.parse(SAMPLE);
    const added = file.add({ kind: "sign", bank: 3, map: 19, index: 1, symbol: "EventScript_Route1_Sign1" });
    expect(added).toMatchObject({ line: 13, kind: "sign", index: 1, conditions: [] });
    expect(file.stringify()).toBe(
      SAMPLE.replace("tile 3 19 0 EventScript_Route1_Tile0\n", "tile 3 19 0 EventScript_Route1_Tile0\nsign 3 19 1 EventScript_Route1_Sign1\n"),
    );
    // 最後の行に改行が無いときは、その行に改行を付けてから足す。
    const other = EventScriptsFile.parse(SAMPLE);
    other.add({ kind: "map", bank: 5, map: 2, symbol: "MapScript_X" });
    expect(other.stringify()).toBe(SAMPLE + "\nmap 5 2 MapScript_X");
    // 空のファイル・CRLF のファイル。
    const empty = EventScriptsFile.parse("");
    empty.add({ kind: "npc", bank: 1, map: 0, index: 0, symbol: "EventScript_A" });
    expect(empty.stringify()).toBe("npc 1 0 0 EventScript_A\n");
    const crlf = EventScriptsFile.parse("## eventscripts\r\n");
    crlf.add({ kind: "tile", bank: 1, map: 0, index: 0, symbol: "EventScript_T" });
    expect(crlf.stringify()).toBe("## eventscripts\r\ntile 1 0 0 EventScript_T\r\n");
  });

  it("シンボルの変更はシンボルの部分だけを書き換える", () => {
    const file = EventScriptsFile.parse(SAMPLE);
    const npc1 = file.entriesFor(3, 19, "person", 1)[0]!;
    const changed = file.setSymbol(npc1, "EventScript_Renamed");
    expect(changed.text).toBe("NPC\t3  19   1   EventScript_Renamed");
    expect(file.stringify()).toBe(SAMPLE.replace("EventScript_Route1_Npc1", "EventScript_Renamed"));
  });

  it("項目を消すと行だけが消え、古い項目での編集は断る", () => {
    const file = EventScriptsFile.parse(SAMPLE);
    const [first, second] = file.entries();
    file.remove(first!);
    expect(file.stringify()).toBe(SAMPLE.replace("map 3 19 MapScript_Route1\n", ""));
    expect(() => file.remove(second!)).toThrow(EventScriptsEditError);
  });

  it("使えない値は断る", () => {
    const file = EventScriptsFile.parse(SAMPLE);
    expect(() => file.add({ kind: "npc", bank: 3, map: 19, symbol: "A" })).toThrow(EventScriptsEditError);
    expect(() => file.add({ kind: "npc", bank: 256, map: 0, index: 0, symbol: "A" })).toThrow(EventScriptsEditError);
    expect(() => file.add({ kind: "npc", bank: 1, map: 0, index: 0, symbol: "A B" })).toThrow(EventScriptsEditError);
    expect(() => file.add({ kind: "npc", bank: 1, map: 0, index: 0, symbol: "#A" })).toThrow(EventScriptsEditError);
    expect(() => file.remapIndexes(3, 19, "person", () => -1)).toThrow(EventScriptsEditError);
    expect(file.stringify()).toBe(SAMPLE);
  });

  it("ProjectFs で読み書きする（無ければ空）", async () => {
    const fs = new MemoryProjectFs();
    const empty = await loadEventScripts(fs);
    expect(empty.entries()).toEqual([]);
    fs.files.set("eventscripts", SAMPLE);
    const file = await loadEventScripts(fs);
    file.removeEvent(1, 0, "sign", 0);
    await saveEventScripts(fs, file);
    expect(fs.files.get("eventscripts")).toBe(SAMPLE.replace("sign 1 0 0 EventScript_Moegi_Sign0\n", ""));
  });
});
