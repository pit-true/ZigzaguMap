import { describe, expect, it } from "vitest";
import { clampRegionMove, clipRegion, planRegionMove, widenForTriple } from "../src/index.js";

/** 幅 w の格子（値は y*100+x。移動許可は上位に x%4）。 */
function grid(w: number, h: number): number[] {
  return Array.from({ length: w * h }, (_, i) => ((i % w) % 4 << 10) | ((Math.floor(i / w) * 100 + (i % w)) & 0x3ff));
}

/** 書くマスを当てた後の格子。 */
function apply(cells: number[], w: number, writes: ReturnType<typeof planRegionMove>): number[] {
  const out = [...cells];
  for (const c of writes) out[c.y * w + c.x] = (c.movement << 10) | c.block;
  return out;
}

describe("moveRegion", () => {
  it("矩形をマップの中に切る", () => {
    expect(clipRegion({ x: -2, y: 1, width: 5, height: 9 }, 10, 6)).toEqual({ x: 0, y: 1, width: 3, height: 5 });
    expect(clipRegion({ x: 12, y: 1, width: 2, height: 2 }, 10, 6)).toBeNull();
  });

  it("ずらす量を端で止める", () => {
    const r = { x: 2, y: 3, width: 3, height: 2 };
    expect(clampRegionMove(r, -5, 0, 10, 8)).toEqual({ dx: -2, dy: 0 });
    expect(clampRegionMove(r, 9, 9, 10, 8)).toEqual({ dx: 5, dy: 3 });
    expect(clampRegionMove(r, 1, -1, 10, 8)).toEqual({ dx: 1, dy: -1 });
    expect(clampRegionMove({ x: 0, y: 0, width: 10, height: 8 }, 3, 3, 10, 8)).toEqual({ dx: 0, dy: 0 });
  });

  it("ブロックと移動許可を動かし、跡を埋める（重なる所は動かした先の値）", () => {
    const w = 8;
    const h = 6;
    const cells = grid(w, h);
    const read = (x: number, y: number): number => cells[y * w + x]!;
    const rect = { x: 1, y: 1, width: 3, height: 2 };
    const writes = planRegionMove(read, rect, 2, 1, () => ({ block: 0x3f0, movement: 0x1 }));
    const after = apply(cells, w, writes);
    // 動かした先は元の値（移動許可も）
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) expect(after[(y + 2) * w + x + 3]).toBe(cells[(y + 1) * w + x + 1]);
    // 跡（元の矩形のうち、先に重ならない所）は埋めた値
    const vacated = [
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [2, 2],
    ];
    for (const [x, y] of vacated) expect(after[y! * w + x!]).toBe((1 << 10) | 0x3f0);
    // ほかは変わらない
    const touched = new Set(writes.map((c) => `${c.x},${c.y}`));
    for (let i = 0; i < cells.length; i++) if (!touched.has(`${i % w},${Math.floor(i / w)}`)) expect(after[i]).toBe(cells[i]);
    expect(writes).toHaveLength(6 + 5);
  });

  it("量が 0 なら書かない。fill が null のマスは書かない", () => {
    const read = (): number => 5;
    expect(planRegionMove(read, { x: 0, y: 0, width: 2, height: 2 }, 0, 0, () => ({ block: 1, movement: 0 }))).toEqual([]);
    const writes = planRegionMove(read, { x: 0, y: 0, width: 2, height: 1 }, 0, 1, (x) => (x === 0 ? null : { block: 1, movement: 0 }));
    expect(writes.filter((c) => c.y === 0)).toEqual([{ x: 1, y: 0, block: 1, movement: 0 }]);
  });

  it("右端で 3 層のブロックと次の番号を切るときは 1 マス広げる", () => {
    const w = 6;
    const cells = new Array(w * 3).fill(1);
    cells[1 * w + 2] = 0x40;
    cells[1 * w + 3] = 0x41;
    const read = (x: number, y: number): number => cells[y * w + x]!;
    const isTriple = (b: number): boolean => b === 0x40;
    expect(widenForTriple({ x: 0, y: 0, width: 3, height: 3 }, read, isTriple, w)).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(widenForTriple({ x: 0, y: 0, width: 4, height: 3 }, read, isTriple, w)).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    // 次の番号が隣に無ければ広げない
    cells[1 * w + 3] = 1;
    expect(widenForTriple({ x: 0, y: 0, width: 3, height: 3 }, read, isTriple, w).width).toBe(3);
  });
});
