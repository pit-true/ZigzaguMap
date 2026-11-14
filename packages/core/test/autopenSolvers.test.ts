import { describe, expect, it } from "vitest";
import {
  AutoPenPlanner,
  PartIndex,
  brushCells,
  brushRect,
  edgeSlotOf,
  gridOf,
  lineCells,
  singleGrid,
  type AutoPenPart,
  type PenSource,
  type PenWrite,
} from "../src/index.js";

/** 文字の格子で書いた小さなマップ（1 文字 = 1 マス。表の文字 → ブロック番号）。 */
class TestMap implements PenSource {
  readonly cells: number[];
  constructor(
    readonly width: number,
    readonly height: number,
    fill: number,
  ) {
    this.cells = new Array(width * height).fill(fill);
  }
  get(x: number, y: number): number | null {
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? null : this.cells[y * this.width + x]!;
  }
  apply(writes: readonly PenWrite[]): void {
    for (const w of writes) this.cells[w.y * this.width + w.x] = w.block | ((w.movement ?? 0) << 10);
  }
  /** ブロックを文字にして行ごとに返す。 */
  rows(names: Record<number, string>): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let r = "";
      for (let x = 0; x < this.width; x++) r += names[this.cells[y * this.width + x]! & 0x3ff] ?? "?";
      out.push(r);
    }
    return out;
  }
}

const LAND = 1;
/** 池（縁つき）のブロック: 枠の名前 → 番号と、表示の文字。 */
const POND_SLOTS = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE", "INW", "INE", "ISW", "ISE"] as const;
const POND_CHARS = "7894561231qwas".split("");
const pondBlock = (slot: string) => 0x100 + POND_SLOTS.indexOf(slot as (typeof POND_SLOTS)[number]);
function pond(extra: Partial<Record<string, number>> = {}): AutoPenPart {
  const slots: Record<string, ReturnType<typeof singleGrid>> = {};
  for (const s of POND_SLOTS) slots[s] = singleGrid(pondBlock(s), s === "C" ? 4 : null);
  for (const [k, v] of Object.entries(extra)) slots[k] = singleGrid(v!);
  return { name: "池", kind: "edge", role: "water", order: 0, slots };
}
const NAMES: Record<number, string> = { [LAND]: "." };
POND_SLOTS.forEach((s, i) => (NAMES[pondBlock(s)] = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "q", "w", "a", "s"][i]!));
void POND_CHARS;

function paint(map: TestMap, planner: AutoPenPlanner, block: number, cells: [number, number][]): PenWrite[] {
  const plan = planner.stroke(map, block, cells);
  if (!plan) throw new Error("パーツがありません");
  map.apply(plan.writes);
  return plan.writes;
}

function rect(x: number, y: number, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([x + dx, y + dy]);
  return out;
}

describe("筆と線（#310）", () => {
  it("奇数の筆は中心、偶数の筆はマスのどちらの半分かで寄せる", () => {
    expect(brushRect(5, 5, 3)).toEqual({ x: 4, y: 4, size: 3 });
    expect(brushRect(5, 5, 5)).toEqual({ x: 3, y: 3, size: 5 });
    expect(brushRect(5, 5, 2, 0.8, 0.8)).toEqual({ x: 5, y: 5, size: 2 });
    expect(brushRect(5, 5, 2, 0.2, 0.2)).toEqual({ x: 4, y: 4, size: 2 });
    expect(brushCells({ x: 0, y: 0, size: 2 })).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it("飛んだマスを線でつなぐ", () => {
    expect(lineCells(0, 0, 3, 1)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
    expect(lineCells(2, 2, 2, 2)).toEqual([[2, 2]]);
  });
});

describe("縁つきの枠の選び方（EdgeSolver）", () => {
  const all = { n: true, s: true, w: true, e: true, nw: true, ne: true, sw: true, se: true };
  it("周りから枠を選ぶ", () => {
    expect(edgeSlotOf(all)).toBe("C");
    expect(edgeSlotOf({ ...all, n: false })).toBe("N");
    expect(edgeSlotOf({ ...all, n: false, w: false })).toBe("NW");
    expect(edgeSlotOf({ ...all, n: false, e: false })).toBe("NE");
    expect(edgeSlotOf({ ...all, s: false, e: false })).toBe("SE");
    expect(edgeSlotOf({ ...all, w: false })).toBe("W");
    expect(edgeSlotOf({ ...all, ne: false })).toBe("INE");
    expect(edgeSlotOf({ ...all, sw: false })).toBe("ISW");
    expect(edgeSlotOf({ ...all, n: false, s: false })).toBe("thin");
    expect(edgeSlotOf({ ...all, w: false, e: false })).toBe("thin");
  });

  it("池で四角を描くと、角・辺・内側が正しく選ばれる", () => {
    const map = new TestMap(8, 7, LAND);
    const planner = new AutoPenPlanner(new PartIndex([pond()]));
    paint(map, planner, pondBlock("C"), rect(2, 1, 4, 4));
    expect(map.rows(NAMES)).toEqual(["........", "..7889..", "..4556..", "..4556..", "..1223..", "........", "........"]);
    // 移動許可: C のマスに決めた値（4）が入る。決めていない枠は書く側が決める
    const w = planner.stroke(map, pondBlock("C"), [[3, 2]]);
    expect(w?.writes).toEqual([]);
  });

  it("凹んだ形で内角が出る", () => {
    const map = new TestMap(9, 8, LAND);
    const planner = new AutoPenPlanner(new PartIndex([pond()]));
    paint(map, planner, pondBlock("C"), rect(1, 1, 6, 6));
    // 右上の角を 3×3 だけ陸にする（面のパーツで消す）
    const land: AutoPenPart = { name: "地面", kind: "fill", role: "ground", order: 1, slots: { Blocks: singleGrid(LAND) } };
    const planner2 = new AutoPenPlanner(new PartIndex([pond(), land]));
    paint(map, planner2, LAND, rect(4, 1, 3, 3));
    expect(map.rows(NAMES)).toEqual([
      ".........",
      ".789.....",
      ".456.....",
      ".456.....",
      ".45w889..",
      ".455556..",
      ".122223..",
      ".........",
    ]);
  });

  it("既存の岸の隣に描いても、元の岸の絵柄（同じ枠の別のブロック）を残す", () => {
    // N の枠に 2 種類のブロック（0x120 は元の絵柄。マップの座標で x が奇数の所に並ぶ）
    const p = pond();
    const alt: AutoPenPart = { ...p, slots: { ...p.slots, N: gridOf(2, 1, [pondBlock("N"), 0x120]) } };
    const names = { ...NAMES, 0x120: "8" };
    const map = new TestMap(8, 6, LAND);
    const planner = new AutoPenPlanner(new PartIndex([alt]));
    paint(map, planner, pondBlock("C"), rect(1, 1, 3, 3));
    // (2,1) を元の絵柄にする（並べるなら N のブロックになる位置）
    map.cells[1 * 8 + 2] = 0x120;
    // 真ん中にもう一度描く。(2,1) は N の枠のブロックなので変えない
    expect(planner.stroke(map, pondBlock("C"), [[2, 2]])?.writes).toEqual([]);
    // 右隣に描くと、角だった (3,1) は N になり、ほかの岸はそのまま
    paint(map, planner, pondBlock("C"), rect(4, 1, 3, 3));
    expect(map.cells[1 * 8 + 2]).toBe(0x120);
    expect(map.rows(names)).toEqual(["........", ".788889.", ".455556.", ".122223.", "........", "........"]);
  });

  it("マップの外は同じとみなす（端に描くと外側に縁を付けない）", () => {
    const map = new TestMap(5, 4, LAND);
    const planner = new AutoPenPlanner(new PartIndex([pond()]));
    paint(map, planner, pondBlock("C"), rect(0, 0, 3, 2));
    expect(map.rows(NAMES)).toEqual(["556..", "223..", ".....", "....."]);
  });

  it("細い所（上下か左右の両方が外）は変えない", () => {
    const map = new TestMap(7, 5, LAND);
    const planner = new AutoPenPlanner(new PartIndex([pond()]));
    paint(map, planner, pondBlock("C"), rect(1, 2, 5, 1));
    expect(map.rows(NAMES)).toEqual([".......", ".......", ".55555.", ".......", "......."]);
  });

  it("2 周目を持つパーツは、C の内側にもう 1 周付ける", () => {
    const ring2: Record<string, number> = { "2NW": 0x130, "2N": 0x131, "2NE": 0x132, "2W": 0x133, "2E": 0x134, "2SW": 0x135, "2S": 0x136, "2SE": 0x137 };
    const names = { ...NAMES, 0x130: "r", 0x131: "t", 0x132: "y", 0x133: "f", 0x134: "h", 0x135: "v", 0x136: "b", 0x137: "n" };
    const map = new TestMap(9, 8, LAND);
    const planner = new AutoPenPlanner(new PartIndex([pond(ring2)]));
    paint(map, planner, pondBlock("C"), rect(1, 1, 6, 6));
    expect(map.rows(names)).toEqual([
      ".........",
      ".788889..",
      ".4rtty6..",
      ".4f55h6..",
      ".4f55h6..",
      ".4vbbn6..",
      ".122223..",
      ".........",
    ]);
  });
});

describe("くり返しと重なって並ぶ木（RepeatSolver・TreeSolver。#311）", () => {
  it("くり返しはマップの座標でそろえて Body を並べ、上下の端に Top・Bottom を付ける", () => {
    const forest: AutoPenPart = {
      name: "模様",
      kind: "repeat",
      role: "ground",
      order: 0,
      slots: { Top: gridOf(2, 1, [0x40, 0x41]), Body: gridOf(2, 2, [0x42, 0x43, 0x44, 0x45]), Bottom: gridOf(2, 1, [0x46, 0x47]) },
    };
    const names = { [LAND]: ".", 0x40: "T", 0x41: "t", 0x42: "A", 0x43: "B", 0x44: "C", 0x45: "D", 0x46: "U", 0x47: "u" };
    const map = new TestMap(6, 8, LAND);
    const planner = new AutoPenPlanner(new PartIndex([forest]));
    paint(map, planner, 0x42, [[1, 3]]);
    // (1,3) を含む 2×2 の単位 (0,2)〜(1,3)。上の端は Top、下の端は Bottom
    expect(map.rows(names)).toEqual(["......", "......", "Tt....", "Uu....", "......", "......", "......", "......"]);
    paint(map, planner, 0x42, [
      [1, 4],
      [1, 5],
    ]);
    expect(map.rows(names)).toEqual(["......", "......", "Tt....", "CD....", "AB....", "Uu....", "......", "......"]);
  });

  /** 木: 先端 T、上の段 A、つなぎ目 J、下の段 B、森の端 a・j・b、真上に木が無い上の段 x（左右で大文字・小文字）。 */
  const tree: AutoPenPart = {
    name: "木",
    kind: "repeat",
    role: "tree",
    order: 0,
    slots: {
      Top: gridOf(2, 1, [0x50, 0x51]),
      Body: gridOf(2, 2, [0x52, 0x53, 0x54, 0x55]),
      Bottom: gridOf(2, 1, [0x56, 0x57]),
      BodyEdge: gridOf(2, 2, [0x58, 0x59, 0x5a, 0x5b]),
      BottomEdge: gridOf(2, 1, [0x5c, 0x5d]),
      BodyTip: gridOf(2, 1, [0x5e, 0x5f]),
    },
  };
  const tnames: Record<number, string> = {
    [LAND]: ".",
    0x50: "T",
    0x51: "t",
    0x52: "A",
    0x53: "a",
    0x54: "J",
    0x55: "j",
    0x56: "B",
    0x57: "b",
    0x58: "E",
    0x59: "e",
    0x5a: "K",
    0x5b: "k",
    0x5c: "F",
    0x5d: "f",
    0x5e: "X",
    0x5f: "x",
  };

  it("木を縦横に描くと、つなぎ目と森の端が選ばれる", () => {
    const map = new TestMap(8, 9, LAND);
    const planner = new AutoPenPlanner(new PartIndex([tree]));
    // 上の段の左が (1,2)・(3,2)・(1,4)・(3,4) の 4 本
    paint(map, planner, 0x52, [[1, 2]]);
    expect(map.rows(tnames)).toEqual(["........", ".Tt.....", ".Ee.....", ".Ff.....", "........", "........", "........", "........", "........"]);
    paint(map, planner, 0x52, [
      [3, 2],
      [1, 4],
      [3, 4],
    ]);
    expect(map.rows(tnames)).toEqual([
      "........",
      ".TtTt...",
      ".ExXe...",
      ".KjJk...",
      ".EaAe...",
      ".FbBf...",
      "........",
      "........",
      "........",
    ]);
  });

  it("消すと周りが直る（右の列を地面で消すと、左の列が森の端になる）", () => {
    const map = new TestMap(8, 9, LAND);
    const land: AutoPenPart = { name: "地面", kind: "fill", role: "ground", order: 1, slots: { Blocks: singleGrid(LAND) } };
    const planner = new AutoPenPlanner(new PartIndex([tree, land]));
    for (const c of [
      [1, 2],
      [3, 2],
      [1, 4],
      [3, 4],
    ] as [number, number][])
      paint(map, planner, 0x52, [c]);
    paint(map, planner, LAND, rect(3, 1, 2, 5));
    expect(map.rows(tnames)).toEqual([
      "........",
      ".Tt.....",
      ".Ee.....",
      ".Kk.....",
      ".Ee.....",
      ".Ff.....",
      "........",
      "........",
      "........",
    ]);
  });

  it("1 マスずれた古い木は消して、近くの木と区切りをそろえる", () => {
    const map = new TestMap(8, 9, LAND);
    const planner = new AutoPenPlanner(new PartIndex([tree]));
    paint(map, planner, 0x52, [[1, 2]]);
    // (4,3) をなぞる: いちばん近い木 (1,2) と区切りをそろえると (3,2)
    paint(map, planner, 0x52, [[4, 3]]);
    expect(map.rows(tnames)[2]).toBe(".ExXe...");
  });
});

describe("範囲を整える（#312）", () => {
  it("崩れた縁を直す", () => {
    const map = new TestMap(8, 7, LAND);
    const planner = new AutoPenPlanner(new PartIndex([pond()]));
    paint(map, planner, pondBlock("C"), rect(2, 1, 4, 4));
    // 辺を C で崩す
    map.cells[1 * 8 + 3] = pondBlock("C");
    map.cells[3 * 8 + 5] = pondBlock("C");
    const writes = planner.tidy(map, rect(0, 0, 8, 7), { edges: true, repeats: false });
    map.apply(writes);
    expect(map.rows(NAMES)).toEqual(["........", "..7889..", "..4556..", "..4556..", "..1223..", "........", "........"]);
  });

  it("くり返しは 5 点以上よくなるずらし方のときだけ並べ直す", () => {
    const body: AutoPenPart = { name: "模様", kind: "repeat", role: "ground", order: 0, slots: { Body: gridOf(2, 2, [0x42, 0x43, 0x44, 0x45]) } };
    const map = new TestMap(6, 6, LAND);
    // 1 マス右にずれた模様で 6×6 を埋める
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) map.cells[y * 6 + x] = [0x42, 0x43, 0x44, 0x45][((y % 2) * 2 + ((x + 1) % 2)) as 0]!;
    const planner = new AutoPenPlanner(new PartIndex([body]));
    // ずれていても模様はそろっているので、並べ直さない（ずらし方 (1,0) で全部合う。今のそろえ方では 0 点）
    const writes = planner.tidy(map, rect(0, 0, 6, 6), { edges: false, repeats: true });
    expect(writes).toEqual([]);
    // 2 マスだけ崩す: ずらし方 (1,0) が最良のまま。崩れた 2 マスだけ直る
    map.cells[0] = 0x45;
    map.cells[7] = 0x42;
    const w2 = planner.tidy(map, rect(0, 0, 6, 6), { edges: false, repeats: true });
    expect(w2.map((w) => [w.x, w.y, w.block])).toEqual([
      [0, 0, 0x43],
      [1, 1, 0x44],
    ]);
  });
});
