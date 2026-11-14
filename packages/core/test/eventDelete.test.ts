import { describe, expect, it } from "vitest";
import {
  AddRomEraseRangesCommand,
  DisasmCommandSet,
  Rom,
  RomEraseProject,
  findPointersInto,
  keepStringsInPlan,
  parseRomErase,
  planRomErase,
  planScriptRemoval,
  projectOverwriteRegions,
  stringifyRomErase,
  withRomErase,
  type EditorContext,
  type RomEraseRange,
} from "../src/index.js";

// #220: イベントの削除（.s の記述を除く計画、ROM の埋める範囲の計画、maps\rom_erase.json）。

const HEAD = '.text\n.thumb\n.align 2\n\n.include "../xse_commands.s"\n\n';

describe(".s と .string から除く計画", () => {
  const asm = `${HEAD}.global Moegi_Npc0
Moegi_Npc0:
\tlock
\tfaceplayer
\tapplymovement 0x1 m_Moegi_Npc0
\tcall Moegi_Npc0_Sub
\tmsgbox gText_Moegi_Npc0 MSG_FACE
\trelease
\tend

Moegi_Npc0_Sub:
\tmsgbox gText_Shared MSG_FACE
\treturn

m_Moegi_Npc0: .byte walk_up, end_m

@ 次のスクリプトの見出し
Moegi_Npc1:
\tmsgbox gText_Shared MSG_FACE
\tend
`;
  const str = "#org @gText_Moegi_Npc0\nこんにちは\\n\nまたね\n\n#org @gText_Shared\nみんなの\n";

  it("入口と下請け・移動データ・その文字列だけを除き、共用のものは残す", () => {
    const plan = planScriptRemoval({
      entry: "Moegi_Npc0",
      asm: [{ path: "assembly/overworld_scripts/moegi.s", text: asm }],
      strings: [{ path: "strings/moegi.string", text: str }],
      external: new Set(["Moegi_Npc1"]),
    });
    expect(plan.removedLabels).toEqual(["Moegi_Npc0", "Moegi_Npc0_Sub", "m_Moegi_Npc0"]);
    expect(plan.removedStrings).toEqual([{ label: "gText_Moegi_Npc0", path: "strings/moegi.string" }]);
    expect(plan.keptStrings).toEqual([{ label: "gText_Shared", reason: "reference", where: "assembly/overworld_scripts/moegi.s:25" }]);
    const s = plan.files.find((f) => f.path.endsWith(".s"))!.after;
    expect(s).toBe(`${HEAD}@ 次のスクリプトの見出し\nMoegi_Npc1:\n\tmsgbox gText_Shared MSG_FACE\n\tend\n`);
    expect(plan.files.find((f) => f.path.endsWith(".string"))!.after).toBe("#org @gText_Shared\nみんなの\n");
  });

  it("ほかのイベントが使う入口は除かない", () => {
    const plan = planScriptRemoval({
      entry: "Moegi_Npc0",
      asm: [{ path: "a.s", text: asm }],
      strings: [{ path: "s.string", text: str }],
      external: new Set(["Moegi_Npc0"]),
    });
    expect(plan.removedLabels).toEqual([]);
    expect(plan.keptLabels.map((k) => k.label)).toEqual(["Moegi_Npc0", "Moegi_Npc0_Sub", "m_Moegi_Npc0"]);
    expect(plan.files).toEqual([]);
  });

  it("ほかの .s やほかのファイルから参照される下請けは残す", () => {
    const other = `${HEAD}X:\n\tcall Moegi_Npc0_Sub\n\tend\n`;
    const plan = planScriptRemoval({
      entry: "Moegi_Npc0",
      asm: [
        { path: "a.s", text: asm },
        { path: "b.s", text: other },
      ],
      strings: [{ path: "s.string", text: str }],
      external: new Set(),
      others: [{ path: "src/x.c", text: "extern const u8 m_Moegi_Npc0[];" }],
    });
    expect(plan.removedLabels).toEqual(["Moegi_Npc0"]);
    expect(plan.keptLabels).toEqual([
      { label: "Moegi_Npc0_Sub", reason: "reference", where: "b.s:8" },
      { label: "m_Moegi_Npc0", reason: "other", where: "src/x.c" },
    ]);
  });

  it("終わりの命令の無いまとまりの続きも一緒に除き、前から続けて実行されるものは残す", () => {
    const text = `${HEAD}A:\n\tlock\nA_Next:\n\trelease\n\tend\n\nB:\n\tlock\nC:\n\tend\n`;
    const a = planScriptRemoval({ entry: "A", asm: [{ path: "a.s", text }], strings: [], external: new Set() });
    expect(a.removedLabels).toEqual(["A", "A_Next"]);
    const c = planScriptRemoval({ entry: "C", asm: [{ path: "a.s", text }], strings: [], external: new Set() });
    expect(c.removedLabels).toEqual([]);
    expect(c.keptLabels).toEqual([{ label: "C", reason: "fallthrough", where: "a.s:13" }]);
  });

  it("取り込みの印と .global、ND の _k の文字列も除く", () => {
    const text = `${HEAD}@ ZigzaguMap: ROM 0x08160A8E から取り込み\n.global R\nR:\n\tmsgbox gText_R MSG_FACE gText_R_k\n\tend\n`;
    const strings = "// ZigzaguMap: ROM 0x08170000 から取り込み\n#org @gText_R\nあ\n\n#org @gText_R_k\nあ\n";
    const plan = planScriptRemoval({ entry: "R", asm: [{ path: "a.s", text }], strings: [{ path: "s.string", text: strings }], external: new Set() });
    expect(plan.files.find((f) => f.path === "a.s")!.after).toBe(HEAD.replace(/\n\n$/, "\n"));
    expect(plan.files.find((f) => f.path === "s.string")!.after).toBe("");
    expect(plan.removedStrings.map((s) => s.label)).toEqual(["gText_R", "gText_R_k"]);
  });

  it("呼ぶ側の理由で文字列を残す（幅検査の REGISTRY）", () => {
    const input = { entry: "Moegi_Npc0", asm: [{ path: "a.s", text: asm }], strings: [{ path: "s.string", text: str }], external: new Set<string>() };
    const plan = keepStringsInPlan(input, planScriptRemoval(input), new Map([["gText_Moegi_Npc0", "REGISTRY"]]));
    expect(plan.removedStrings).toEqual([]);
    expect(plan.keptStrings.map((k) => k.reason)).toContain("registry");
    expect(plan.files.map((f) => f.path)).toEqual(["a.s"]);
  });

  it("入口が無ければ何もしない", () => {
    expect(planScriptRemoval({ entry: "Nope", asm: [{ path: "a.s", text: asm }], strings: [], external: new Set() }).scriptPath).toBeNull();
  });
});

function romWith(parts: [number, number[]][], size = 0x2000): Rom {
  const bytes = new Uint8Array(size).fill(0xff);
  for (const [at, data] of parts) bytes.set(data, at);
  return new Rom(bytes);
}
const ptr = (offset: number) => {
  const v = 0x08000000 + offset;
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
};

describe("ROM の埋める範囲の計画", () => {
  // 0x1100: loadpointer 0 0x1200 / callstd 6 / loadpointer 0 0x1280 / callstd 6 / end
  const script = [0x0f, 0x00, ...ptr(0x1200), 0x09, 0x06, 0x0f, 0x00, ...ptr(0x1280), 0x09, 0x06, 0x02];
  const parts: [number, number[]][] = [
    [0x1100, script],
    [0x1200, [0x01, 0x02, 0xff]],
    [0x1280, [0x03, 0xff]],
    [0x1400, ptr(0x1280)], // ほかのところから共用の文字列を指す
    [0x1500, ptr(0x1100)], // 消すイベントの元のイベント表
  ];
  const commands = DisasmCommandSet.bundled();

  it("指されていない範囲だけ埋め、ほかから指される文字列は残す", () => {
    const plan = planRomErase(romWith(parts), 0x1100, { commands, ignore: [{ from: 0x1500, to: 0x1518 }] });
    expect(plan.erase.map((s) => [s.type, s.offset, s.length])).toEqual([
      ["script", 0x1100, script.length],
      ["text", 0x1200, 3],
    ]);
    expect(plan.keep.map((s) => [s.type, s.offset, s.reason])).toEqual([["text", 0x1280, { kind: "pointer", at: 0x1400 }]]);
  });

  it("元のイベント表を数えないと入口が指されているので、全部残す", () => {
    const plan = planRomErase(romWith(parts), 0x1100, { commands });
    expect(plan.erase).toEqual([]);
    expect(plan.keep.map((s) => s.reason.kind)).toEqual(["pointer", "keptParent", "pointer"]);
  });

  it("プロジェクトの参照・上書きする領域・記録済みは埋めない", () => {
    const rom = romWith(parts);
    const ignore = [{ from: 0x1500, to: 0x1518 }];
    expect(planRomErase(rom, 0x1100, { commands, ignore, references: [{ address: 0x08001201, where: "maps/03/00.json" }] }).keep[0]!.reason).toEqual({
      kind: "reference",
      where: "maps/03/00.json",
    });
    expect(planRomErase(rom, 0x1100, { commands, ignore, protect: [{ from: 0x1202, to: 0x1203, where: "bytereplacement:1" }] }).keep[0]!.reason.kind).toBe("protected");
    const recorded = planRomErase(rom, 0x1100, { commands, ignore, recorded: [{ address: 0x08001100, length: 0x110 }] });
    expect(recorded.erase).toEqual([]);
    expect(recorded.keep.map((k) => k.reason.kind)).toEqual(["recorded", "recorded", "pointer"]);
  });

  it("ポインタはどの位置からでも探す", () => {
    const rom = romWith([[0x31, ptr(0x204)]]);
    expect(findPointersInto(rom.bytes, [{ offset: 0x200, length: 8 }])).toEqual([{ at: 0x31, span: 0 }]);
  });

  it("プロジェクトが上書きする領域", () => {
    const regions = projectOverwriteRegions(
      [
        { name: "bytereplacement", text: "# x\n0808377A 08 F0 FD F9\n" },
        { name: "hooks", text: "EmitPrintString 800DCC8 2\n" },
        { name: "repoints", text: "gMoveDescriptions 080E63F0\n" },
        { name: "special_inserts.asm", text: ".org 0x1234\n.word 0\n" },
      ],
      0x1000000,
    );
    expect(regions).toEqual([
      { from: 0x8377a, to: 0x8377e, where: "bytereplacement:2" },
      { from: 0xdcc8, to: 0xdcd8, where: "hooks:1" },
      { from: 0xe63f0, to: 0xe63f4, where: "repoints:1" },
      { from: 0x1234, to: 0x1274, where: "special_inserts.asm:1" },
      { from: 0x1000000, to: 0x2000000, where: "OFFSET_TO_PUT 0x1000000" },
    ]);
  });
});

describe("maps\\rom_erase.json", () => {
  const range: RomEraseRange = { address: 0x0816a2b4, length: 37, type: "script", bank: 3, map: 0, event: "person", index: 2 };

  it("Bochi と同じ整形で書き、読み直すと同じ。知らない項目は残す", () => {
    const text = stringifyRomErase({ ranges: [range], extra: {} });
    expect(text).toBe(
      '{\r\n  "Format": 1,\r\n  "Ranges": [\r\n    {\r\n      "Address": "0x0816A2B4",\r\n      "Length": 37,\r\n      "Type": "script",\r\n      "Bank": 3,\r\n      "Map": 0,\r\n      "Event": "person",\r\n      "Index": 2\r\n    }\r\n  ]\r\n}\r\n',
    );
    expect(parseRomErase(text).ranges).toEqual([range]);
    const withExtra = parseRomErase('{"Format":1,"Note":"x","Ranges":[{"Address":"0x08000100","Length":1,"Why":"y"}]}');
    expect(stringifyRomErase(withExtra)).toContain('"Note": "x"');
    expect(stringifyRomErase(withExtra)).toContain('"Why": "y"');
  });

  it.each([
    ['{"Format":2}'],
    ['{"Ranges":[{"Address":"0x07000000","Length":1}]}'],
    ['{"Ranges":[{"Address":"0x08000000","Length":0}]}'],
    ['{"Ranges":{}}'],
  ])("形の違うものは読まない %s", (text) => {
    expect(() => parseRomErase(text)).toThrow();
  });

  it("記録のコマンドは二重に足さず、取り消すと消える", async () => {
    const project = RomEraseProject.of({ ranges: [], extra: {} });
    const context = withRomErase({} as EditorContext, () => project);
    const command = new AddRomEraseRangesCommand({ ranges: [range, { ...range, address: range.address + 4, length: 2 }] });
    command.do(context);
    expect(project.ranges).toEqual([range]);
    expect(project.isModified()).toBe(true);
    command.undo(context);
    expect(project.ranges).toEqual([]);
    expect(project.isModified()).toBe(false);
    expect(() => new AddRomEraseRangesCommand({ ranges: [{ ...range, address: 0x100 }] }).do(context)).toThrow(RangeError);
    const files = new Map<string, string>();
    const fs = {
      writeText: async (p: string, t: string) => void files.set(p, t),
      remove: async (p: string) => void files.delete(p),
    } as unknown as Parameters<RomEraseProject["save"]>[0];
    command.do(context);
    expect(await project.save(fs)).toEqual({ written: ["maps/rom_erase.json"], removed: [] });
    command.undo(context);
    expect(await project.save(fs)).toEqual({ written: [], removed: ["maps/rom_erase.json"] });
  });
});

describe("ROM の埋める範囲の計画（読めないもの）", () => {
  const commands = DisasmCommandSet.bundled();

  it("逆アセンブルで読めない箇所があれば、何も埋めない", () => {
    // goto の行き先が ROM の外（でたらめなポインタの先を読んだときなど）
    const rom = romWith([[0x1100, [0x05, 0x49, 0x47, 0x18, 0x05]]]);
    const plan = planRomErase(rom, 0x1100, { commands });
    expect(plan.erase).toEqual([]);
    expect(plan.keep.map((k) => k.reason.kind)).toEqual(["unreadable"]);
    expect(plan.problems.length).toBeGreaterThan(0);
  });

  it("ROM の先頭のヘッダーは読まない", () => {
    const plan = planRomErase(romWith([[0, [0x02]]]), 0, { commands });
    expect(plan.erase).toEqual([]);
    expect(plan.keep).toEqual([]);
  });
});
