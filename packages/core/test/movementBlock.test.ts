import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countMovementReferences,
  movementBlockFromRom,
  parseAsmLine,
  readMovementBlock,
  writeMovementBlock,
  type MovementBlock,
} from "../src/index.js";
import { BUNDLED_MOVEMENT_NAMES } from "../src/script/disasm/bundledCommands.js";

const NAMES = new Map<string, number>(Object.entries(BUNDLED_MOVEMENT_NAMES).map(([hex, name]) => [name, parseInt(hex, 16)]));
const resolve = (name: string) => NAMES.get(name) ?? null;
const byValue = new Map([...NAMES].map(([n, v]) => [v, n]));
const nameOf = (v: number) => byValue.get(v) ?? null;

function read(text: string, label: string): MovementBlock {
  const b = readMovementBlock(text, label, resolve);
  expect(b).not.toBeNull();
  return b!;
}

describe("移動データの読み取り（#449）", () => {
  it("ラベルと同じ行の 1 行", () => {
    const b = read("m_A: .byte walk_up, walk_up, end_m\n", "m_A");
    expect(b.problem).toBeNull();
    expect(b.steps.map((s) => s.value)).toEqual([0x11, 0x11]);
    expect(b.endStep?.text).toBe("end_m");
    expect(b.steps[1]).toMatchObject({ line: 0, text: "walk_up" });
  });

  it("1 行 1 命令、16 進、コメント、CRLF", () => {
    const text = "m_B:\r\n\t.byte walk_down @ 下へ\r\n\t.byte 0x60\r\n\t.byte end_m\r\nnext:\r\n";
    const b = read(text, "m_B");
    expect(b.problem).toBeNull();
    expect(b.steps.map((s) => [s.value, s.text, s.line])).toEqual([
      [0x10, "walk_down", 1],
      [0x60, "0x60", 2],
    ]);
  });

  it("読めないもの: end_m が無い、.if、マクロ、知らない名前、2 か所のラベル、途中のラベル", () => {
    expect(read("m: .byte walk_up\n", "m").problem?.kind).toBe("noEnd");
    expect(read("m: .byte walk_up\n.if 1\n.byte end_m\n.endif\n", "m").problem?.kind).toBe("conditional");
    expect(read(".if 0\nm: .byte walk_up, end_m\n.endif\n", "m").problem?.kind).toBe("conditional");
    expect(read("m: .byte walk_up\n\tmsgbox x 6\n", "m").problem).toMatchObject({ kind: "macro", line: 1 });
    expect(read("m: .byte walk_sideways, end_m\n", "m").problem).toMatchObject({ kind: "unknownName", detail: "walk_sideways" });
    expect(read("m: .byte end_m\nm: .byte end_m\n", "m").problem?.kind).toBe("duplicateLabel");
    const inside = read("m: .byte walk_up\nn: .byte end_m\n", "m");
    expect(inside.problem?.kind).toBe("labelInside");
    expect(inside.steps.length).toBe(1);
    expect(readMovementBlock("x: .byte end_m\n", "m", resolve)).toBeNull();
  });

  it("ROM の移動データは書き戻せない印", () => {
    const b = movementBlockFromRom({ label: "ROM_1", offset: 0, steps: [0x10, 0x60, 0xfe], names: ["walk_down", null, "end_m"] });
    expect(b.steps.map((s) => s.text)).toEqual(["walk_down", "0x60"]);
    expect(b.problem?.kind).toBe("rom");
  });
});

describe("移動データの書き戻し（#449）", () => {
  const write = (text: string, label: string, values: number[]) => writeMovementBlock(text, read(text, label), values, nameOf);

  it("変えずに書くと 1 文字も変わらない", () => {
    for (const text of [
      "m_A: .byte walk_up, walk_up, end_m\n",
      "a\r\nm_B:\r\n\t.byte walk_down @ 下へ\r\n\t.byte 0x60\r\n\t.byte end_m\r\nnext:\r\n",
      "m_C:\n  .byte walk_up,walk_left\n  .byte end_m @ おわり\n",
    ]) {
      const label = /^(?:a\r\n)?(m_\w)/.exec(text)![1]!;
      const b = read(text, label);
      expect(writeMovementBlock(text, b, b.steps.map((s) => s.value), nameOf)).toBe(text);
    }
  });

  it("1 行の形: 足す・消す・差し替え", () => {
    const text = "x:\nm_A: .byte walk_up, walk_up, end_m @ c\ny:\n";
    expect(write(text, "m_A", [0x11, 0x11, 0x12])).toBe("x:\nm_A: .byte walk_up, walk_up, walk_left, end_m @ c\ny:\n");
    expect(write(text, "m_A", [0x11])).toBe("x:\nm_A: .byte walk_up, end_m @ c\ny:\n");
    expect(write(text, "m_A", [0x13, 0x11])).toBe("x:\nm_A: .byte walk_right, walk_up, end_m @ c\ny:\n");
    expect(write(text, "m_A", [])).toBe("x:\nm_A: .byte end_m @ c\ny:\n");
    expect(write(text, "m_A", [0x1b])).toBe("x:\nm_A: .byte 0x1B, end_m @ c\ny:\n");
  });

  it("1 行 1 命令の形: 行ごとに足す・消す、コメントと 16 進を残す", () => {
    const text = "m_B:\r\n\t.byte walk_down @ 下へ\r\n\t.byte 0x60\r\n\t.byte end_m\r\n";
    expect(write(text, "m_B", [0x10, 0x60, 0x11])).toBe("m_B:\r\n\t.byte walk_down @ 下へ\r\n\t.byte 0x60\r\n\t.byte walk_up\r\n\t.byte end_m\r\n");
    expect(write(text, "m_B", [0x60])).toBe("m_B:\r\n\t.byte 0x60\r\n\t.byte end_m\r\n");
    expect(write(text, "m_B", [0x12, 0x60])).toBe("m_B:\r\n\t.byte walk_left @ 下へ\r\n\t.byte 0x60\r\n\t.byte end_m\r\n");
    // 並べ替え（動かした命令のコメントは命令に付いていく）
    expect(write(text, "m_B", [0x60, 0x10])).toBe("m_B:\r\n\t.byte 0x60\r\n\t.byte walk_down @ 下へ\r\n\t.byte end_m\r\n");
  });

  it("書いた本文を読み直すと新しい並び", () => {
    const text = "m:\n\t.byte walk_up, walk_up\n\t.byte walk_left\n\t.byte end_m\n";
    for (const values of [[], [0x10], [0x13, 0x13, 0x13, 0x13], [0x11, 0x12, 0x11], [0x12, 0x11, 0x11, 0x60]]) {
      const out = write(text, "m", values);
      const again = read(out, "m");
      expect(again.problem, out).toBeNull();
      expect(again.steps.map((s) => s.value)).toEqual(values);
    }
  });

  it("ラベルの行の項目が全部消えても、ラベルは残る", () => {
    const text = "m: .byte walk_up\n\t.byte end_m\n";
    const out = write(text, "m", []);
    expect(out).toBe("m:\n\t.byte end_m\n");
  });

  it("書き戻せないものは例外", () => {
    const text = "m: .byte walk_up\n";
    expect(() => write(text, "m", [])).toThrow();
  });

  it("使っている所を数える", () => {
    const files = [
      { path: "a.s", text: "m_W: .byte walk_up, end_m\n\tapplymovement PLAYER m_W\n" },
      { path: "b.s", text: "@ m_W\n\tapplymovement 1, m_W\n\tapplymovement 2 m_Wx\n" },
    ];
    expect(countMovementReferences(files, "m_W")).toEqual([
      { path: "a.s", line: 1 },
      { path: "b.s", line: 1 },
    ]);
  });
});

/** 実フォルダ（読むだけ）。設定されていなければ飛ばす。 */
const projects = [
  { name: "ND", dir: process.env.ZIGZAGU_ND_DIR },
  { name: "Chronos", dir: process.env.ZIGZAGU_CHRONOS_DIR },
];

for (const { name, dir } of projects) {
  describe.skipIf(!dir || !existsSync(join(dir, "assembly", "overworld_scripts")))(`実フォルダの移動データ（${name}）`, () => {
    it("overworld_scripts の移動データを全部読み、変えずに書くと同じ本文", () => {
      const defines = readFileSync(join(dir!, "xse_defines.s"), "utf8");
      const values = new Map<string, number>();
      for (const row of defines.split(/\r?\n/)) {
        const m = /^\s*\.equ\s+([A-Za-z_][\w]*)\s*,\s*(0x[0-9a-fA-F]+|\d+)/.exec(row);
        if (m) values.set(m[1]!, Number(m[2]!));
      }
      const res = (n: string) => values.get(n) ?? null;
      const folder = join(dir!, "assembly", "overworld_scripts");
      let read = 0;
      let conditional = 0;
      const others: string[] = [];
      const files = readdirSync(folder)
        .filter((f) => f.endsWith(".s"))
        .map((f) => ({ file: f, text: readFileSync(join(folder, f), "utf8") }));
      // applymovement の 2 つ目の引数のラベル（どのファイルのものも）。
      const labels = new Set<string>();
      for (const { text } of files) {
        for (const row of text.split(/\r?\n/)) {
          const l = parseAsmLine(row);
          if (!l.op || !/^applymovement/i.test(l.text.slice(l.op.start, l.op.end))) continue;
          const arg = l.args[1];
          if (arg && arg.kind === "symbol") labels.add(l.text.slice(arg.start, arg.end));
        }
      }
      for (const { file, text } of files) {
        for (const label of labels) {
          const b = readMovementBlock(text, label, res);
          if (!b) continue; // 別のファイルのラベル
          if (b.problem?.kind === "conditional") {
            conditional++;
            continue;
          }
          if (b.problem) {
            others.push(`${file} ${label} ${b.problem.kind} ${b.problem.detail ?? ""}`);
            continue;
          }
          read++;
          expect(writeMovementBlock(text, b, b.steps.map((s) => s.value), () => null), `${file} ${label}`).toBe(text);
        }
      }
      console.log(`${name}: 移動データ ${read} 件を読んだ（.if の中 ${conditional} 件、ほか ${others.length} 件）${others.length ? "\n" + others.join("\n") : ""}`);
      expect(read).toBeGreaterThan(0);
      expect(others).toEqual([]);
    });
  });
}
