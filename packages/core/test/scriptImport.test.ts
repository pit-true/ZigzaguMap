import { describe, expect, it } from "vitest";
import { DisasmCommandSet, ROM_BASE, Rom, findImportedLabels, planScriptImport } from "../src/index.js";

/** 0x100 にスクリプト（lock・faceplayer・loadpointer・callstd 2・goto 0x120）、0x120 に end、0x140 に文字列。 */
function rom(): Rom {
  const bytes = new Uint8Array(0x400);
  const put = (at: number, ...b: number[]) => bytes.set(b, at);
  const ptr = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  put(0x100, 0x6a, 0x5a, 0x0f, 0x00, ...ptr(ROM_BASE + 0x140), 0x09, 0x02, 0x05, ...ptr(ROM_BASE + 0x120));
  put(0x120, 0x6c, 0x02);
  put(0x140, 0x01, 0x02, 0x03, 0xff);
  return new Rom(bytes);
}

describe("ROM のスクリプトの取り込み", () => {
  const base = { commands: DisasmCommandSet.bundled(), useGlobal: false, label: "Moegi_Npc3" };

  it("入口・たどった先・文字列にラベルを付け、印を書く", () => {
    const plan = planScriptImport(rom(), 0x100, { ...base, dialect: "chronos" });
    expect(plan.entryLabel).toBe("Moegi_Npc3");
    expect(plan.items.map((i) => [i.kind, i.label])).toEqual([
      ["script", "Moegi_Npc3"],
      ["script", "Moegi_Npc3_1"],
      ["string", "gText_Moegi_Npc3_1"],
    ]);
    expect(plan.asm[0]).toBe("@ ZigzaguMap: ROM 0x08000100 から取り込み");
    expect(plan.asm).toContain("\tloadpointer 0x0 gText_Moegi_Npc3_1");
    expect(plan.asm).toContain("\tgoto Moegi_Npc3_1");
    expect(plan.strings[0]).toBe("// ZigzaguMap: ROM 0x08000140 から取り込み");
    expect(plan.strings[1]).toBe("#org @gText_Moegi_Npc3_1");
    expect(plan.blocks[0]).toMatchObject({ label: "Moegi_Npc3", offset: 0x100 });
    expect(plan.blocks[0]!.pointers).toEqual([4, 11]);
  });

  it("ND は同じ本文の _k を作って 0F を指し直す。名前は変えられる", () => {
    const plan = planScriptImport(rom(), 0x100, { ...base, dialect: "nd", rename: new Map([["gText_Moegi_Npc3_1", "gText_Hello"]]) });
    expect(plan.asm).toContain("\tloadpointer 0x0 gText_Hello gText_Hello_k");
    expect(plan.strings.filter((l) => l.startsWith("#org"))).toEqual(["#org @gText_Hello", "#org @gText_Hello_k"]);
  });

  it("前に取り込んだアドレスはそのラベルを使い、書かない", () => {
    const first = planScriptImport(rom(), 0x100, { ...base, dialect: "chronos" });
    const existing = findImportedLabels([...first.asm, ...first.strings].join("\n"));
    expect([...existing.entries()]).toEqual([
      [0x100, "Moegi_Npc3"],
      [0x120, "Moegi_Npc3_1"],
      [0x140, "gText_Moegi_Npc3_1"],
    ]);
    expect(planScriptImport(rom(), 0x100, { ...base, label: "Other", dialect: "chronos", existing })).toMatchObject({ entryLabel: "Moegi_Npc3", reused: true });
    const sub = planScriptImport(rom(), 0x100, { ...base, label: "Other", dialect: "chronos", existing: new Map([[0x120, "Shared"]]) });
    expect(sub.asm).toContain("\tgoto Shared");
    expect(sub.asm.some((l) => l === "Shared:")).toBe(false);
  });
});
