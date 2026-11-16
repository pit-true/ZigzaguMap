import { describe, expect, it } from "vitest";
import { defaultFacingOf, NpcSimulation, npcMovementType, npcMovementTypes, type NpcSource, type NpcWorld } from "../src/index.js";

/** 幅 w・高さ h、全部通れて高さ 3 のマップ。walls のマスは衝突、cells で個別の移動許可、behaviors で挙動。 */
function world(w: number, h: number, opts: { walls?: [number, number][]; cells?: Record<string, number>; behaviors?: Record<string, number> } = {}): NpcWorld {
  const walls = new Set((opts.walls ?? []).map(([x, y]) => `${x},${y}`));
  return {
    width: w, height: h,
    movement: (x, y) => x < 0 || y < 0 || x >= w || y >= h ? null : opts.cells?.[`${x},${y}`] ?? (walls.has(`${x},${y}`) ? 1 | (3 << 2) : 3 << 2),
    behavior: (x, y) => opts.behaviors?.[`${x},${y}`] ?? 0,
  };
}
function person(movementType: number, x = 5, y = 5, extra: Partial<NpcSource> = {}): NpcSource {
  return { localId: 1, graphicsId: 4, x, y, elevation: 3, movementType, movementRangeX: 0, movementRangeY: 0, ...extra };
}
/** 同じ式の乱数（pp_rand）。 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 0x41c64e6d) + 0x6073) >>> 0; return s >>> 16; };
}
function run(sim: NpcSimulation, frames: number) {
  const out = [];
  for (let i = 0; i < frames; i++) { sim.step(); out.push(sim.actors()[0]!); }
  return out;
}

describe("移動タイプの表", () => {
  it("0x00〜0x50 の 81 種類があり、表の外は null", () => {
    const all = npcMovementTypes();
    expect(all).toHaveLength(81);
    expect(all.map(t => t.id)).toEqual([...Array(81).keys()]);
    expect(npcMovementType(0x51)).toBeNull();
    expect(all[0x02]!.name).toBe("MV_ON");
    expect(all[0x50]!.name).toBe("MV_ON_SLOW");
    expect(all.filter(t => t.limitFlag).map(t => t.id)).toEqual([2, 3, 4, 5, 6, ...Array.from({ length: 32 }, (_, i) => 25 + i), 59, 60, 61, 62, 80]);
    expect(all.filter(t => t.family === "route3")).toHaveLength(24);
    expect(all.filter(t => t.preview === "unsupported").map(t => t.id)).toEqual([0x4d, 0x4e, 0x4f]);
  });
});

describe("歩き回る", () => {
  it("最初の待ちは表から乱数で選び、待ちが終わったフレームに 1 歩目を出す", () => {
    const r = rng(7);
    const wait = [32, 64, 96, 128][r() & 3]!;
    const dir = (["down", "up", "left", "right"] as const)[r() & 3]!;
    const sim = new NpcSimulation(world(11, 11), [person(0x02, 5, 5, { movementRangeX: 3, movementRangeY: 3 })], 7);
    const states = run(sim, wait + 20);
    // 1 フレーム目（index 0）で向き・待ちの準備と 1 回目の減算。待ちが 0 になるフレームで歩き始める。
    expect(states.slice(0, wait - 1).every(s => s.movementId === null || s.movementId === 0x00)).toBe(true);
    const start = states.findIndex(s => s.movementId !== null && s.movementId >= 0x10);
    expect(start).toBe(wait - 1);
    expect(states[start]!.facing).toBe(dir);
    expect(states[start]!.movementId).toBe(0x10 + ["down", "up", "left", "right"].indexOf(dir));
    expect(states[start + 15]!.pixelX % 16 + states[start + 15]!.pixelY % 16).toBe(0);
    expect(Math.abs(states[start + 15]!.tileX - 5) + Math.abs(states[start + 15]!.tileY - 5)).toBe(1);
  });

  it("同じ種なら同じ動き、reset で最初に戻る", () => {
    const make = () => new NpcSimulation(world(11, 11), [person(0x02, 5, 5, { movementRangeX: 2, movementRangeY: 2 })], 99);
    const a = run(make(), 2000), sim = make(), b = run(sim, 2000);
    expect(b).toEqual(a);
    sim.reset();
    expect(run(sim, 2000)).toEqual(a);
  });

  it("範囲 0 は 1 に直し、元の位置から 1 マスより離れない", () => {
    const sim = new NpcSimulation(world(11, 11), [person(0x02)], 3);
    const states = run(sim, 20000);
    expect(states.every(s => Math.abs(s.tileX - 5) <= 1 && Math.abs(s.tileY - 5) <= 1)).toBe(true);
    expect(new Set(states.map(s => `${s.tileX},${s.tileY}`)).size).toBeGreaterThan(3);
  });

  it("縦だけ・横だけの型は軸を外れない", () => {
    for (const [type, axis] of [[0x03, "x"], [0x05, "y"]] as const) {
      const states = run(new NpcSimulation(world(11, 11), [person(type, 5, 5, { movementRangeX: 3, movementRangeY: 3 })], 11), 20000);
      expect(states.every(s => (axis === "x" ? s.tileX : s.tileY) === 5)).toBe(true);
      expect(new Set(states.map(s => `${s.tileX},${s.tileY}`)).size).toBeGreaterThan(2);
    }
  });

  it("壁・マップの外・一方通行・高さ・ほかの人物・主人公には入らない", () => {
    const walls: [number, number][] = [[4, 5], [6, 5], [5, 4]];
    // 下は高さ 5 で入れない。
    const w = world(11, 11, { walls, cells: { "5,6": 5 << 2 } });
    const states = run(new NpcSimulation(w, [person(0x02, 5, 5, { movementRangeX: 3, movementRangeY: 3 })], 5), 10000);
    expect(states.every(s => s.tileX === 5 && s.tileY === 5)).toBe(true);
    const sim = new NpcSimulation(world(11, 11, { behaviors: { "5,5": 0x33 } }), [person(0x02)], 1);
    expect(sim.hitAt(1, 5, 6, "down")).toBe("attribute");
    expect(sim.hitAt(1, 5, 4, "up")).toBeNull();
    const sim2 = new NpcSimulation(world(11, 11, { behaviors: { "5,4": 0x33 } }), [person(0x02)], 1);
    expect(sim2.hitAt(1, 5, 4, "up")).toBe("attribute");
    const corner = new NpcSimulation(world(1, 1), [person(0x02, 0, 0, { movementRangeX: 3, movementRangeY: 3 })], 1);
    expect(corner.hitAt(1, 0, 1, "down")).toBe("attribute");
    const two = new NpcSimulation(world(11, 11), [person(0x02), { ...person(0x00, 5, 6), localId: 2 }], 1);
    expect(two.hitAt(1, 5, 6, "down")).toBe("object");
    two.step([{ x: 4, y: 5, elevation: 3 }]);
    expect(two.hitAt(1, 4, 5, "left")).toBe("object");
    two.step([{ x: 4, y: 5, elevation: 4 }]);
    expect(two.hitAt(1, 4, 5, "left")).toBeNull();
    expect(two.hitAt(1, 5, 2, "up")).toBe("limit");
  });

  it("低速は 0.5 倍の歩き（31 フレーム）", () => {
    const states = run(new NpcSimulation(world(11, 11), [person(0x50, 5, 5, { movementRangeX: 3, movementRangeY: 3 })], 2), 600);
    const walk = states.filter(s => s.movementId !== null && s.movementId >= 0x08 && s.movementId <= 0x0b);
    expect(walk.length).toBeGreaterThan(0);
    expect(states.some(s => s.movementId !== null && s.movementId >= 0x10 && s.movementId <= 0x13)).toBe(false);
    expect(Math.max(...walk.map(s => s.actionFrame))).toBe(30);
  });
});

describe("向き", () => {
  it("2 方向の見回しは表の向きだけ、待ちは短い表", () => {
    const states = run(new NpcSimulation(world(11, 11), [person(0x0f)], 4), 5000);
    expect(new Set(states.map(s => s.facing))).toEqual(new Set(["up", "left"]));
    expect(states.every(s => s.tileX === 5 && s.tileY === 5)).toBe(true);
    const changes = states.flatMap((s, i) => i && s.facing !== states[i - 1]!.facing ? [i] : []);
    expect(changes.length).toBeGreaterThan(10);
  });

  it("回る型は 49 フレームごとに表の順で向きを変える", () => {
    const left = run(new NpcSimulation(world(11, 11), [person(0x17)], 0), 49 * 4 + 1).map(s => s.facing);
    expect(left[0]).toBe("down");
    expect([left[49], left[98], left[147], left[196]]).toEqual(["right", "up", "left", "down"]);
    expect(left[48]).toBe("down");
    const right = run(new NpcSimulation(world(11, 11), [person(0x18)], 0), 50).map(s => s.facing);
    expect(right[49]).toBe("left");
  });

  it("固定の向きと消える型", () => {
    const fixed = run(new NpcSimulation(world(11, 11), [person(0x07)], 0), 300);
    // EvObjDefaultSiteTbl は 0x07 が上（名前の MV_DOWN と食い違う。配列の値に従う）。
    expect(fixed.every(s => s.facing === defaultFacingOf(0x07) && s.facing === "up" && s.visible)).toBe(true);
    const gone = run(new NpcSimulation(world(11, 11), [person(0x4c)], 0), 2);
    expect(gone[0]!.visible).toBe(false);
  });
});

describe("道", () => {
  it("往復は範囲の端で折り返し、元の位置で向きを戻す", () => {
    const sim = new NpcSimulation(world(11, 11), [person(0x1b, 5, 5, { movementRangeX: 2 })], 0);
    const xs = run(sim, 16 * 12).filter((_, i) => i % 16 === 15).map(s => s.tileX);
    // 元の位置へ戻ると基本の向きへ戻すので、元の位置と範囲の端の間を往復する。
    expect(xs).toEqual([4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 5]);
  });

  it("往復は壁ではその場で足踏みする", () => {
    const states = run(new NpcSimulation(world(11, 11, { walls: [[4, 5]] }), [person(0x1b, 5, 5, { movementRangeX: 2 })], 0), 64);
    expect(states.every(s => s.tileX === 5)).toBe(true);
    expect(states[0]!.movementId).toBe(0x25 + 2);
  });

  it("周回は表の順に回って元の位置へ戻る", () => {
    const sim = new NpcSimulation(world(11, 11), [person(0x1d, 5, 5, { movementRangeX: 1, movementRangeY: 1 })], 0);
    const cells = run(sim, 16 * 16).filter((_, i) => i % 16 === 15).map(s => `${s.tileX},${s.tileY}`);
    // URLD: 上へ端まで → 右へ端まで → 左へ元の x を越えて端まで → … と元の位置へ戻る周期。
    expect(cells.slice(0, 2)).toEqual(["5,4", "6,4"]);
    expect(cells).toContain("5,5");
    const period = cells.indexOf("5,5") + 1;
    expect(cells.slice(period, period * 2)).toEqual(cells.slice(0, period));
  });
});

describe("止めて見せる型", () => {
  it("足踏みは命令を続け、まね・隠れ・再戦・表の外は理由を返して動かない", () => {
    const stay = run(new NpcSimulation(world(11, 11), [person(0x48)], 0), 40);
    expect(stay.map(s => s.movementId)).toEqual(Array(40).fill(0x2d));
    expect(stay.every(s => s.tileX === 5 && s.facing === "down")).toBe(true);
    for (const [type, reason] of [[0x35, "copy"], [0x39, "hide"], [0x4d, "unsupported"], [0x51, "unknown"], [0x00, "still"]] as const) {
      const sim = new NpcSimulation(world(11, 11), [person(type)], 0);
      run(sim, 200);
      expect(sim.status()[0]!.reason).toBe(reason);
      expect(sim.actors()[0]!.movementId).toBeNull();
    }
  });
});

describe("トレーナーの視界", () => {
  const tiles = (sim: NpcSimulation, id = 1, range = 5, all = false) => sim.sight(id, range, all).map(r => ({ d: r.direction, t: r.tiles.map(t => `${t.x},${t.y}`), b: r.blocked && `${r.blocked.x},${r.blocked.y}:${r.blocked.hit}` }));

  it("今の向きの直線で、距離はイベントの値。0 は見えない", () => {
    const sim = new NpcSimulation(world(11, 11), [person(0x08, 5, 2)], 0);
    expect(tiles(sim, 1, 3)).toEqual([{ d: "down", t: ["5,3", "5,4", "5,5"], b: null }]);
    expect(sim.sight(1, 0, false)).toEqual([]);
    // 最大（15）でもマップの外で止まる
    expect(tiles(sim, 1, 15)[0]!.t).toHaveLength(8);
    expect(tiles(sim, 1, 15)[0]!.b).toBe("5,11:attribute");
  });

  it("全方向は下・上・左・右の 4 本", () => {
    const sim = new NpcSimulation(world(11, 11), [person(0x08, 5, 5)], 0);
    expect(tiles(sim, 1, 2, true).map(r => [r.d, r.t])).toEqual([
      ["down", ["5,6", "5,7"]], ["up", ["5,4", "5,3"]], ["left", ["4,5", "3,5"]], ["right", ["6,5", "7,5"]],
    ]);
  });

  it("壁・一方通行・高さ・ほかの人物で遮られ、移動範囲は見ない", () => {
    const wall = new NpcSimulation(world(11, 11, { walls: [[5, 5]] }), [person(0x08, 5, 2, { movementRangeX: 1, movementRangeY: 1 })], 0);
    expect(tiles(wall)).toEqual([{ d: "down", t: ["5,3", "5,4"], b: "5,5:attribute" }]);
    // 下向きに入れない一方通行（0x33 は「下へ移動不可」なので、自分のマスに置くと最初から見えない）
    const ledge = new NpcSimulation(world(11, 11, { behaviors: { "5,4": 0x32 } }), [person(0x08, 5, 2)], 0);
    expect(tiles(ledge)).toEqual([{ d: "down", t: ["5,3"], b: "5,4:attribute" }]);
    const high = new NpcSimulation(world(11, 11, { cells: { "5,4": 6 << 2, "5,5": 0 } }), [person(0x08, 5, 2)], 0);
    expect(tiles(high)).toEqual([{ d: "down", t: ["5,3"], b: "5,4:height" }]);
    const other = new NpcSimulation(world(11, 11), [person(0x08, 5, 2), { ...person(0x00, 5, 4), localId: 2 }], 0);
    expect(tiles(other)).toEqual([{ d: "down", t: ["5,3"], b: "5,4:object" }]);
    // 主人公は見る相手なので遮らない
    other.step([{ x: 5, y: 3, elevation: 3 }]);
    expect(tiles(other)[0]!.t).toEqual(["5,3"]);
  });

  it("自分のマスが衝突なら見えない（元の版は自分のマスから調べる）", () => {
    const sim = new NpcSimulation(world(11, 11, { walls: [[5, 2]] }), [person(0x08, 5, 2)], 0);
    expect(tiles(sim)).toEqual([{ d: "down", t: [], b: "5,2:attribute" }]);
  });

  it("移動範囲は元の位置が中心で、0 を 1 に直すタイプだけ 1", () => {
    const sim = new NpcSimulation(world(11, 11), [person(0x02, 5, 5), { ...person(0x08, 2, 2), localId: 2 }, { ...person(0x1b, 7, 7, { movementRangeX: 3 }), localId: 3 }], 0);
    expect(sim.rangeOf(1)).toEqual({ x0: 4, y0: 4, x1: 6, y1: 6 });
    expect(sim.rangeOf(2)).toBeNull();
    expect(sim.rangeOf(3)).toEqual({ x0: 4, y0: 6, x1: 10, y1: 8 });
  });
});
