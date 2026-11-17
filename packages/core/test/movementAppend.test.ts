import { describe, expect, it } from "vitest";
import {
  newMovementLabel,
  planMovementAppend,
  planMovementCopy,
  planMovementRewrite,
  readApplyMovementLine,
  readMovementBlock,
} from "../src/index.js";

const NAMES = new Map<number, string>([[0x10, "walk_down"], [0x11, "walk_up"], [0x12, "walk_left"], [0x13, "walk_right"], [0xfe, "end_m"]]);
const nameOf = (v: number) => NAMES.get(v) ?? null;
const resolve = (name: string) => [...NAMES].find(([, n]) => n === name)?.[0] ?? (/^0x[0-9a-f]+$/i.test(name) ? parseInt(name, 16) : null);

describe("なぞった道の .s への書き込み（#518）", () => {
  it("新しいラベルの名前は Move_<マップ名>_<番号>。使われていれば次の番号", () => {
    const taken = new Set(["Move_Moegi_1", "Move_Moegi_2"]);
    expect(newMovementLabel("Moegi", (n) => taken.has(n))).toBe("Move_Moegi_3");
    expect(newMovementLabel("Map3_0", () => false)).toBe("Move_Map3_0_1");
  });

  it("新しいラベル: ファイルの最後に空行をはさんで 1 行の形で足す。名前の無い値は 16 進、改行はファイルに合わせる", () => {
    const plan = planMovementAppend({ path: "a.s", text: "Main:\n\tend\n", label: "Move_A_1", values: [0x11, 0x11, 0x1b], nameOf })!;
    expect(plan.newLabel).toBe("Move_A_1");
    expect(plan.changes[0]!.after).toBe("Main:\n\tend\n\nMove_A_1: .byte walk_up, walk_up, 0x1B, end_m\n");
    const crlf = planMovementAppend({ path: "a.s", text: "Main:\r\n\tend", label: "M", values: [0x10], nameOf, useGlobal: true })!;
    expect(crlf.changes[0]!.after).toBe("Main:\r\n\tend\r\n\r\n.global M\r\nM: .byte walk_down, end_m\r\n");
    // 最後がもう空行なら、空行を足さない
    expect(planMovementAppend({ path: "a.s", text: "x\n\n", label: "M", values: [0x10], nameOf })!.changes[0]!.after).toBe("x\n\nM: .byte walk_down, end_m\n");
    expect(planMovementAppend({ path: "a.s", text: "", label: "1bad", values: [0x10], nameOf })).toBeNull();
  });

  it("置き換え: 開いたもとの移動データの値を全部なぞった道にする（書き方とコメントは保つ）", () => {
    const text = "Main:\n\tapplymovement 1 m_Walk\n\tend\n\nm_Walk: .byte walk_up, walk_up, end_m @ 2 歩\n";
    const block = readMovementBlock(text, "m_Walk", resolve)!;
    const plan = planMovementRewrite("a.s", text, block, [0x13, 0x13, 0x10], nameOf);
    expect(plan.changes[0]!.after).toBe("Main:\n\tapplymovement 1 m_Walk\n\tend\n\nm_Walk: .byte walk_right, walk_right, walk_down, end_m @ 2 歩\n");
    // 共用の移動データを写すときは、このスクリプトの applymovement だけ付け替える
    const shared = "A:\n\tapplymovement 1 m\n\tend\nB:\n\tapplymovement 2 m\n\tend\nm: .byte walk_up, end_m\n";
    const b = readMovementBlock(shared, "m", resolve)!;
    const copy = planMovementCopy({ movementPath: "a.s", block: b, commandPath: "a.s", commandLine: 4, newLabel: "m_2", values: [0x12], nameOf }, () => shared)!;
    expect(copy.changes[0]!.after).toBe("A:\n\tapplymovement 1 m\n\tend\nB:\n\tapplymovement 2 m_2\n\tend\nm: .byte walk_up, end_m\nm_2: .byte walk_left, end_m\n");
  });

  it("applymovement の行の人物とラベル", () => {
    expect(readApplyMovementLine("\tapplymovement 0xFF m_Walk @ 主人公")).toEqual({ actor: "0xFF", label: "m_Walk" });
    expect(readApplyMovementLine("\tapplymovement PLAYER, m_Walk")).toEqual({ actor: "PLAYER", label: "m_Walk" });
    expect(readApplyMovementLine("\twaitmovement 0")).toBeNull();
  });
});
