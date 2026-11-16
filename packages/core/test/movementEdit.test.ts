import { describe, expect, it } from "vitest";
import { applyMovementEdit, copyLabelName, planMovementCopy, planMovementRewrite, readMovementBlock, repeatRun } from "../src/index.js";

const resolve = (s: string) => ({ walk_up: 0x11, walk_down: 0x10, end_m: 0xfe })[s] ?? null;
const name = (v: number) => v === 0x11 ? "walk_up" : v === 0x10 ? "walk_down" : null;

describe("移動データの編集", () => {
  it("向き、挿入、削除、並べ替え、連続回数を元の配列を変えずに編集する", () => {
    const original = [0x11, 0x11, 0x10];
    expect(applyMovementEdit(original, { type: "direction", index: 0, direction: "down" })).toEqual([0x10, 0x11, 0x10]);
    expect(applyMovementEdit(original, { type: "insert", index: 1, value: 0x10, after: true })).toEqual([0x11, 0x11, 0x10, 0x10]);
    expect(applyMovementEdit(original, { type: "delete", index: 1 })).toEqual([0x11, 0x10]);
    expect(applyMovementEdit(original, { type: "move", from: 2, to: 0 })).toEqual([0x10, 0x11, 0x11]);
    expect(applyMovementEdit(original, { type: "repeat", index: 1, count: 3 })).toEqual([0x11, 0x11, 0x11, 0x10]);
    expect(original).toEqual([0x11, 0x11, 0x10]);
  });
  it("範囲外と終端の挿入は拒むが、空の移動には命令を足せる", () => {
    expect(applyMovementEdit([], { type: "insert", index: 0, value: 0x11 })).toEqual([0x11]);
    expect(applyMovementEdit([], { type: "insert", index: -1, after: true, value: 0x11 })).toBeNull();
    expect(applyMovementEdit([0x11], { type: "replace", index: 0, value: 0xfe })).toBeNull();
    expect(applyMovementEdit([0x11], { type: "repeat", index: 0, count: 256 })).toBeNull();
    expect(repeatRun([], 0).count).toBe(0);
  });
  it("共有のデータをそのまま編集する場合もコメントと改行を保つ", () => {
    const text = "m: .byte walk_up, end_m @ コメント\r\nnext: end\r\n";
    const block = readMovementBlock(text, "m", resolve)!;
    const plan = planMovementRewrite("a.s", text, block, [0x10, 0x11], name);
    expect(plan.newLabel).toBeNull();
    expect(plan.changes[0]!.after).toContain("@ コメント\r\nnext: end\r\n");
    expect(readMovementBlock(plan.changes[0]!.after, "m", resolve)!.steps.map((s) => s.value)).toEqual([0x10, 0x11]);
  });
  it.each([false, true])("同じファイルの前後どちらにある呼び出しも1か所だけ付け替える（後ろ=%s）", (after) => {
    const movement = "m: .byte walk_up, end_m\r\n";
    const command = "script: applymovement 1, m @ m は共有\r\n";
    const text = after ? movement + command : command + movement;
    const block = readMovementBlock(text, "m", resolve)!;
    const result = planMovementCopy({ movementPath: "a.s", block, commandPath: "a.s", commandLine: after ? 1 : 0, newLabel: "m_2", values: [0x10], nameOf: name }, () => text)!;
    expect(result.changes).toHaveLength(1);
    const out = result.changes[0]!.after;
    expect(out).toContain("applymovement 1, m_2 @ m は共有\r\n");
    expect(out).toContain(movement);
    expect(readMovementBlock(out, "m_2", resolve)!.steps.map((s) => s.value)).toEqual([0x10]);
  });
  it("別ファイルの呼び出しを付け替え、元の移動を残す", () => {
    const movement = "m: .byte walk_up, end_m";
    const block = readMovementBlock(movement, "m", resolve)!;
    const result = planMovementCopy({ movementPath: "m.s", block, commandPath: "c.s", commandLine: 0, newLabel: "m_2", values: [], nameOf: name }, (p) => p === "m.s" ? movement : "applymovement 1, m\n")!;
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]!.after).toBe(movement + "\nm_2: .byte end_m");
    expect(result.changes[1]!.after).toBe("applymovement 1, m_2\n");
  });
  it("命令が変わった古い行番号と、書けない移動ブロックには書かない", () => {
    const text = "m: .byte walk_up, end_m\nmessage m\n";
    const block = readMovementBlock(text, "m", resolve)!;
    const args = { movementPath: "a.s", block, commandPath: "a.s", commandLine: 1, newLabel: "m_2", values: [], nameOf: name };
    expect(planMovementCopy(args, () => text)).toBeNull();
    expect(planMovementCopy({ ...args, block: { ...block, problem: { kind: "conditional", line: 0, detail: null } } }, () => text)).toBeNull();
    expect(copyLabelName("m", (s) => s === "m_2")).toBe("m_3");
  });
});
