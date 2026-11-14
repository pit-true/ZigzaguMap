import { describe, expect, it } from "vitest";
import { DisasmCommandSet, Rom, ScriptTextCodec, parseAsmNumber, summarizeAsmScript, summarizeOps, summarizeRomScript, summaryText } from "../src/index.js";

const CHARMAP = ["00= ", "01=あ", "02=い", "03=う", "FB=\\p", "FE=\\n", "FF=$", "/FF", ""].join("\n");
const text = ScriptTextCodec.fromCharmap(CHARMAP);
const names = {
  item: (id: number) => ({ 13: "キズぐすり", 4: "モンスターボール" })[id] ?? null,
  species: (id: number) => ({ 1: "フシギダネ", 25: "ピカチュウ" })[id] ?? null,
};

function romWith(parts: [number, number[]][], size = 0x200): Rom {
  const bytes = new Uint8Array(size).fill(0xff);
  for (const [at, data] of parts) bytes.set(data, at);
  return new Rom(bytes);
}
const ptr = (offset: number) => {
  const v = (0x08000000 + offset) >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
};
const u16 = (v: number) => [v & 0xff, v >>> 8];

describe("セリフの整形", () => {
  it("制御記号を外して 1 行にし、60 字で切る", () => {
    expect(summaryText("あいう\\nえお\\pかき")).toBe("あいう えお かき");
    expect(summaryText("[player]は\\c[1]だ")).toBe("はだ");
    expect(summaryText("あ".repeat(70))).toBe(`${"あ".repeat(60)}…`);
    expect(summaryText("ここは [PLAYER]の いえ")).toBe("ここは （主人公）の いえ");
  });
  it("数の書き方", () => {
    expect(parseAsmNumber("0x1F")).toBe(31);
    expect(parseAsmNumber("12")).toBe(12);
    expect(parseAsmNumber("0b101")).toBe(5);
    expect(parseAsmNumber("ITEM_POTION")).toBeNull();
  });
});

describe("命令の並びの要約", () => {
  it("セリフは 1 命令に 1 つ（ND の 2 ポインタの msgbox は先の方）、5 件まで", () => {
    const t = (s: string) => ({ value: null, symbol: "x", text: s, mart: null });
    const ops = Array.from({ length: 7 }, (_, i) => ({ command: "msgbox", args: [t(`ひらがな${i}`), t(`漢字${i}`), { value: 6, symbol: null, text: null, mart: null }] }));
    const s = summarizeOps(ops);
    expect(s.entries).toEqual([0, 1, 2, 3, 4].map((i) => ({ type: "text", text: `ひらがな${i}` })));
    expect(s.truncated).toBe(true);
  });
  it("変数で渡した種族は名前にしない", () => {
    const s = summarizeOps([{ command: "givepokemon", args: [{ value: 0x4001, symbol: null, text: null, mart: null }, { value: 5, symbol: null, text: null, mart: null }] }], names);
    expect(s.entries).toEqual([{ type: "pokemon", species: "変数 0x4001", level: 5 }]);
  });
  it("同じものは 1 回だけ", () => {
    const item = { command: "giveitem", args: [{ value: 13, symbol: null, text: null, mart: null }, { value: 1, symbol: null, text: null, mart: null }] };
    expect(summarizeOps([item, item], names).entries).toEqual([{ type: "item", item: "キズぐすり", amount: 1 }]);
  });
  it("品物は 5 件までと残りの数", () => {
    const s = summarizeOps([{ command: "pokemart", args: [{ value: null, symbol: "Mart", text: null, mart: [13, 4, 1, 2, 3, 5, 6] }] }], names);
    expect(s.entries).toEqual([{ type: "mart", items: ["キズぐすり", "モンスターボール", "#1", "#2", "#3"], more: 2 }]);
  });
});

describe("素の ROM のスクリプトの要約", () => {
  const commands = DisasmCommandSet.bundled();
  const rom = romWith([
    [0x000, [0x0f, 0x00, ...ptr(0x100)]], // loadpointer 0 → 0x100
    [0x006, [0x09, 0x06]], // callstd 6
    [0x008, [0x5c, 0x00, ...u16(0x15f), ...u16(0), ...ptr(0x110), ...ptr(0x118)]], // trainer 0 0x15F 0 intro loss
    [0x016, [0x86, ...ptr(0x120)]], // mart → 0x120
    [0x01b, [0x44, ...u16(13), ...u16(2)]], // additem 13 2
    [0x020, [0x79, ...u16(25), 5, ...u16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0]], // givepokemon 25 5 0 0 0 0
    [0x02f, [0xb6, ...u16(1), 7, ...u16(0)]], // setwild 1 7 0
    [0x035, [0x02]], // end
    [0x100, [0x01, 0x02, 0xfe, 0x03, 0xff]], // あい\nう
    [0x110, [0x03, 0x03, 0xff]], // うう
    [0x118, [0x01, 0xff]],
    [0x120, [...u16(13), ...u16(4), 0, 0]],
  ]);

  it("セリフ・トレーナー・品物・アイテム・ポケモン・野生戦を拾う", () => {
    const s = summarizeRomScript(rom, 0x08000000, { commands, text }, names);
    expect(s.entries).toEqual([
      { type: "text", text: "あい う" },
      { type: "trainer", id: 0x15f, symbol: null, intro: "うう" },
      { type: "mart", items: ["キズぐすり", "モンスターボール"], more: 0 },
      { type: "item", item: "キズぐすり", amount: 2 },
      { type: "pokemon", species: "ピカチュウ", level: 5 },
      { type: "wild", species: "フシギダネ", level: 7 },
    ]);
  });

  it("ROM の外は problems", () => {
    const s = summarizeRomScript(rom, 0x09000000, { commands, text });
    expect(s.entries).toEqual([]);
    expect(s.problems.length).toBe(1);
  });
});

describe(".s のスクリプトの要約", () => {
  const strings: Record<string, string> = {
    gText_Hello_Kana: "こんにちは",
    gText_Hello: "今日は",
    gText_Intro: "勝負だ！",
    gText_Got: "もらった",
  };
  const source = { stringText: (l: string) => strings[l] ?? null, constant: (n: string) => ({ ITEM_POTION: 13 })[n] ?? null };
  const asm = [
    "EventScript_Test:",
    "\tlock",
    "\tfaceplayer",
    "\tcheckflag 0x200",
    "\tgoto_if 0x1 EventScript_Test_Done",
    "\tmsgbox gText_Hello_Kana gText_Hello MSG_NORMAL @ ND は 2 ポインタ",
    "\tgiveitem ITEM_POTION 1 MSG_OBTAIN",
    "\tcall EventScript_Sub",
    "\tpokemart EventScript_Mart",
    "\trelease",
    "\tend",
    "",
    "EventScript_Test_Done:",
    "\tmsgbox gText_Got MSG_NORMAL",
    "\trelease",
    "\tend",
    "",
    "EventScript_Sub:",
    "\ttrainerbattle0 0x0 0x15F 0x0 gText_Intro gText_Got",
    "\treturn",
    "",
    ".align 1",
    "EventScript_Mart:",
    "\t.hword ITEM_POTION, 4",
    "\t.hword 0",
    "",
    "EventScript_Other:",
    "\tmsgbox gText_Other MSG_NORMAL",
    "\tend",
  ].join("\r\n");

  it("ラベルからたどり、call・goto の行き先も同じファイルの中で拾う", () => {
    const s = summarizeAsmScript(asm, "EventScript_Test", source, names);
    expect(s.entries).toEqual([
      { type: "text", text: "こんにちは" },
      { type: "item", item: "キズぐすり", amount: 1 },
      { type: "mart", items: ["キズぐすり", "モンスターボール"], more: 0 },
      { type: "text", text: "もらった" },
      { type: "trainer", id: 0x15f, symbol: null, intro: "勝負だ！" },
    ]);
    expect(s.problems).toEqual([]);
  });

  it("ラベルが無ければ problems", () => {
    expect(summarizeAsmScript(asm, "Nope", source).problems).toEqual(["ラベル Nope が見つかりません"]);
  });

  it("定数が引けなければ名前のまま", () => {
    const s = summarizeAsmScript("A:\n\tgiveitem ITEM_X 1\n\tend\n", "A", { stringText: () => null }, names);
    expect(s.entries).toEqual([{ type: "item", item: "ITEM_X", amount: 1 }]);
  });
});
