import { describe, expect, it } from "vitest";
import {
  BlockGrid,
  CommandGroup,
  EditError,
  LineLock,
  ShiftMapCommand,
  SmartPath,
  boxResizeCommands,
  floodRegion,
  matchingCells,
  patternCells,
  shiftGrid,
  type PenSource,
  type PenWrite,
} from "../src/index.js";
import { M00, M01, openLoaded, roundTrip } from "./helpers/editHarness.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

/** 文字の行から作る配置（1 文字 = ブロック番号の 16 進 1 桁。移動許可は 0）。 */
function gridOf(rows: readonly string[], movements?: readonly string[]): BlockGrid {
  const w = rows[0]!.length;
  const cells = new Uint16Array(w * rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => (cells[y * w + x] = parseInt(ch, 16) | (parseInt(movements?.[y]?.[x] ?? "0", 16) << 10))));
  return new BlockGrid(w, rows.length, cells);
}

const pts = (list: readonly { x: number; y: number }[]): string[] => list.map((p) => `${p.x},${p.y}`);

describe("塗りつぶし（fill.ts）", () => {
  const grid = gridOf(["1121", "1221", "1111", "3313"]);

  it("上下左右につながった同じブロックだけを集める（斜めはつながらない）", () => {
    expect(pts(floodRegion(grid, 2, 1, "block"))).toEqual(["2,0", "1,1", "2,1"]);
    expect(pts(floodRegion(grid, 0, 3, "block"))).toEqual(["0,3", "1,3"]);
    expect(floodRegion(grid, 0, 0, "block")).toHaveLength(10);
  });

  it("マップの外を押したら空", () => {
    expect(floodRegion(grid, -1, 0, "block")).toEqual([]);
    expect(floodRegion(grid, 4, 0, "block")).toEqual([]);
    expect(matchingCells(grid, 0, 9, "block")).toEqual([]);
  });

  it("マジック塗りはつながっていない同じマスも全部", () => {
    expect(pts(matchingCells(grid, 0, 3, "block"))).toEqual(["0,3", "1,3", "3,3"]);
  });

  it("移動許可だけで見る（ブロックが違ってもつながる）", () => {
    const g = gridOf(["1234", "5678"], ["1100", "1000"]);
    expect(pts(floodRegion(g, 0, 0, "movement"))).toEqual(["0,0", "1,0", "0,1"]);
    expect(pts(floodRegion(g, 0, 0, "block"))).toEqual(["0,0"]);
  });

  it("スタンプは押したマスを左上にしてくり返す（左・上へも揃う。穴は書かない）", () => {
    const cells = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 0 },
    ];
    const out = patternCells(cells, { x: 1, y: 1 }, { width: 2, height: 2, blocks: [10, 11, 12, 13], movements: [1, 2, 3, 4], holes: [false, false, false, true] });
    expect(out).toEqual([
      { x: 1, y: 1, block: 10, movement: 1 },
      { x: 2, y: 1, block: 11, movement: 2 },
      { x: 0, y: 1, block: 11, movement: 2 },
      { x: 1, y: 2, block: 12, movement: 3 },
    ]);
  });

  it("1 マスの選択は全部同じブロック（移動許可を持たない）", () => {
    expect(patternCells([{ x: 3, y: 4 }], { x: 0, y: 0 }, { width: 1, height: 1, blocks: [7] })).toEqual([{ x: 3, y: 4, block: 7 }]);
  });
});

describe("直線（LineLock）", () => {
  it("始点から 2 マス目へ動いた向きで軸を決め、その軸に寄せる", () => {
    const l = new LineLock();
    expect(l.constrain(5, 5)).toEqual({ x: 5, y: 5 });
    l.start(5, 5);
    expect(l.constrain(5, 5)).toEqual({ x: 5, y: 5 });
    expect(l.axis).toBeNull();
    expect(l.constrain(6, 6)).toEqual({ x: 6, y: 5 });
    expect(l.axis).toBe("x");
    expect(l.constrain(9, 2)).toEqual({ x: 9, y: 5 });
    l.start(9, 5);
    expect(l.constrain(9, 7)).toEqual({ x: 9, y: 7 });
    expect(l.constrain(3, 8)).toEqual({ x: 9, y: 8 });
    expect(l.axis).toBe("y");
    l.stop();
    expect(l.active).toBe(false);
    expect(l.constrain(3, 8)).toEqual({ x: 3, y: 8 });
  });
});

describe("マップシフト", () => {
  it("はみ出た行と列は反対側に出る", () => {
    const g = gridOf(["123", "456"]);
    const s = shiftGrid(g, 1, 1);
    expect([...s.cells]).toEqual([6, 4, 5, 3, 1, 2]);
    expect([...shiftGrid(g, -4, 3).cells]).toEqual([...shiftGrid(g, -1, 1).cells]);
    expect([...shiftGrid(g, 0, 0).cells]).toEqual([...g.cells]);
  });

  it("ShiftMapCommand は 1 回で戻り、JSON から作り直しても同じ。移動許可も一緒に動き、イベントは動かない", async () => {
    const rom = buildSyntheticRom();
    const open = async () => {
      const p = await openLoaded(rom);
      p.loaded(M00)!.grid = new BlockGrid(4, 3, Uint16Array.from({ length: 12 }, (_, i) => i | ((i % 4) << 10)));
      return p;
    };
    const before = await open();
    const person = { ...before.loaded(M00)!.events!.persons[0]! };
    await roundTrip(open, () => new ShiftMapCommand({ ...M00, dx: -1, dy: 2 }), (p) => {
      const doc = p.loaded(M00)!;
      expect(doc.grid.getCell(3, 2)).toBe(0);
      expect(doc.grid.getMovement(3, 2)).toBe(0);
      expect(doc.grid.getCell(0, 2)).toBe(1 | (1 << 10));
      expect([doc.width, doc.height]).toEqual([4, 3]);
      expect(doc.events!.persons[0]).toEqual(person);
    });
  });
});

describe("対話式リサイズ（4 辺）", () => {
  const rom = buildSyntheticRom();
  const open = async () => {
    const p = await openLoaded(rom);
    p.loaded(M00)!.grid = new BlockGrid(6, 6, Uint16Array.from({ length: 36 }, (_, i) => i + 1));
    return p;
  };

  it("左と上へ広げ、右を縮める。広げた所は柄で埋まり、柄はできあがりの座標でそろう。1 回で戻る", async () => {
    const base = await open();
    const person = { ...base.loaded(M00)!.events!.persons[0]! };
    await roundTrip(
      open,
      () => new CommandGroup(boxResizeCommands(M00, 6, 6, { left: 2, right: -1, up: 1, down: 0 }, [M01], { width: 2, height: 2, cells: [100, 101, 102, 103] })),
      (p) => {
        const doc = p.loaded(M00)!;
        expect([doc.width, doc.height]).toEqual([7, 7]);
        // 元の左上は (2, 1) へ
        expect(doc.grid.getCell(2, 1)).toBe(1);
        // 広げた所は、できあがりの座標で (x % 2, y % 2) の柄
        for (const [x, y] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 5],
          [6, 0],
        ] as const) {
          expect(doc.grid.getCell(x, y)).toBe(100 + (y % 2) * 2 + (x % 2));
        }
        expect(doc.events!.persons[0]!.x).toBe(person.x + 2);
        expect(doc.events!.persons[0]!.y).toBe(person.y + 1);
      },
    );
  });

  it("柄を渡さなければ今と同じ端の写し", async () => {
    const p = await open();
    const cmds = boxResizeCommands(M00, 6, 6, { left: 0, right: 2, up: 0, down: 0 }, []);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]!.args.fill).toBeUndefined();
    expect(p.loaded(M00)!.grid.getCell(5, 0)).toBe(6);
  });

  it("縮める辺を先にする（小さすぎる途中を避けるときは広げる辺を先）", () => {
    const sides = (box: { left: number; right: number; up: number; down: number }, w = 6, h = 6) => boxResizeCommands(M00, w, h, box, []).map((c) => c.args.side);
    expect(sides({ left: 3, right: -2, up: 0, down: 1 })).toEqual(["right", "left", "down"]);
    expect(sides({ left: -3, right: 3, up: 0, down: 0 }, 6)).toEqual(["right", "left"]);
    expect(sides({ left: 0, right: 0, up: 0, down: 0 })).toEqual([]);
  });

  it("できあがりが小さすぎる・上限を超えるときは作らない", () => {
    expect(() => boxResizeCommands(M00, 6, 6, { left: -3, right: 0, up: 0, down: 0 }, [])).toThrow(EditError);
    expect(() => boxResizeCommands(M00, 6, 6, { left: 0, right: 600, up: 0, down: 0 }, [])).toThrow(EditError);
  });
});

/** 小さなマップ（ブロック番号の格子）。 */
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
  rows(names: Record<number, string>): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let r = "";
      for (let x = 0; x < this.width; x++) r += names[this.cells[y * this.width + x]! & 0x3ff] ?? ".";
      out.push(r);
    }
    return out;
  }
}

describe("スマートパス", () => {
  // 3×3: 1 2 3 / 4 5 6 / 7 8 9（5 が中）
  const names: Record<number, string> = { 1: "┌", 2: "─", 3: "┐", 4: "│", 5: "#", 6: "│", 7: "└", 8: "_", 9: "┘" };

  it("3×3 でなければ作らない", () => {
    expect(SmartPath.of(2, 2, [1, 2, 3, 4])).toBeNull();
    expect(SmartPath.of(3, 3, [1, 2, 3])).toBeNull();
  });

  it("3×3 の範囲を描くと、周りに合わせた角と辺になる", () => {
    const sp = SmartPath.of(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9])!;
    expect(sp.center).toBe(5);
    const map = new TestMap(7, 6, 0);
    const cells: [number, number][] = [];
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 5; x++) cells.push([x, y]);
    map.apply(sp.stroke(map, cells));
    expect(map.rows(names)).toEqual([".......", ".┌───┐.", ".│###│.", ".│###│.", ".└___┘.", "......."]);
  });

  it("描き足すと、つながった所の縁を選び直す（移動許可も見本のもの）", () => {
    const sp = SmartPath.of(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 1, 1, 1, 0, 1, 1, 1, 1])!;
    const map = new TestMap(8, 5, 0);
    const box = (x0: number, x1: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let y = 1; y <= 3; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
      return out;
    };
    map.apply(sp.stroke(map, box(1, 3)));
    map.apply(sp.stroke(map, box(4, 6)));
    expect(map.rows(names)).toEqual(["........", ".┌────┐.", ".│####│.", ".└____┘.", "........"]);
    expect(map.get(1, 1)! >> 10).toBe(1);
  });
});
