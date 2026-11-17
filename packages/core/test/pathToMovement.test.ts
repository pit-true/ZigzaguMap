import { describe, expect, it } from "vitest";
import {
  movementAction,
  PathOps,
  pathProblems,
  pathToMovement,
  pathWalkSpeeds,
  PLAYER_ID,
  ScriptCommandTable,
  ScriptIndex,
  simulatePlayback,
  stepsBetween,
  tracePath,
  waitValues,
  walkOp,
  type PathOp,
  type PathWorld,
} from "../src/index.js";

const walk = (d: "down" | "up" | "left" | "right", speed?: number): PathOp => walkOp(d, speed)!;

describe("道をなぞって移動データを作る（#517）", () => {
  it("直線と曲がり角: 同じ向きの歩きはそのまま並べる", () => {
    const ops = [walk("right"), walk("right"), walk("down"), walk("left")];
    expect(pathToMovement(ops)).toEqual([0x13, 0x13, 0x10, 0x12]);
    const t = tracePath({ x: 5, y: 5, facing: "up" }, ops);
    expect(t.end).toEqual({ x: 6, y: 6, facing: "left" });
    expect(t.steps.map((s) => [s.to.x, s.to.y])).toEqual([[6, 5], [7, 5], [7, 6], [6, 6]]);
  });

  it("斜めや離れたマスへのドラッグは、横を先に、次に縦に分ける", () => {
    expect(stepsBetween({ x: 2, y: 2 }, { x: 3, y: 3 })).toEqual(["right", "down"]);
    expect(stepsBetween({ x: 2, y: 2 }, { x: 0, y: 0 })).toEqual(["left", "left", "up", "up"]);
    expect(stepsBetween({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([]);
  });

  it("向きだけ・待ち・速さ", () => {
    expect(pathToMovement([{ kind: "face", direction: "left" }])).toEqual([0x02]);
    expect(waitValues(20)).toEqual([0x1c, 0x1a]);
    expect(waitValues(31)).toEqual([0x1c, 0x1b, 0x1a, 0x19, 0x18]);
    expect(() => waitValues(0)).toThrow(RangeError);
    // 速さ: 2 倍（run_*）の上向き、0.5 倍の右向き
    expect(walk("up", 0x1d).kind === "walk" && (walk("up", 0x1d) as { value: number }).value).toBe(0x1e);
    expect(pathToMovement([walk("right", 0x08)])).toEqual([0x0b]);
    // 速さの一覧は 1 マス進む歩きの 4 つ組だけ（ジャンプは入れない）
    const speeds = pathWalkSpeeds();
    expect(speeds).toContain(0x10);
    expect(speeds).toContain(0x08);
    expect(speeds.every((id) => movementAction(id).kind === "walk")).toBe(true);
    expect(speeds).not.toContain(0x14);
    expect(walkOp("up", 0x14)).toBeNull();
    // 向きは歩きの位置を変えない
    expect(tracePath({ x: 1, y: 1, facing: "down" }, [{ kind: "face", direction: "up" }, { kind: "wait", frames: 4 }]).end).toEqual({ x: 1, y: 1, facing: "up" });
  });

  it("通れないマス: マップの外・衝突・高さ・人物。高さ 0 と 15 は通れる", () => {
    // 4×3。(2,0) は壁（衝突 1）、(3,1) は高さ 4、(1,2) は高さ 15 の橋、(2,2) に人物
    const m = new Map<string, number>([["2,0", 1 | (3 << 2)], ["3,1", 4 << 2], ["1,2", 15 << 2]]);
    const world: PathWorld = { width: 4, height: 3, movementAt: (x, y) => m.get(`${x},${y}`) ?? 3 << 2, occupied: [{ x: 2, y: 2 }] };
    const ops = [walk("right"), walk("up"), walk("down"), walk("right"), walk("left"), walk("down"), walk("left"), walk("down")];
    // (0,1)→(1,1)→(1,0)→(1,1)→(2,1)→(1,1)→(1,2)→(0,2)→(0,3)外
    const problems = pathProblems({ x: 0, y: 1, facing: "down" }, ops, world);
    expect(problems).toEqual([{ index: 7, reason: "outside", x: 0, y: 3 }]);
    const wall = pathProblems({ x: 1, y: 0, facing: "down" }, [walk("right"), walk("down"), walk("right"), walk("down")], world);
    // 高さ 4 に上がった後は、高さ 3 へ戻るのも段差
    expect(wall.map((p) => [p.index, p.reason])).toEqual([[0, "collision"], [2, "elevation"], [3, "elevation"]]);
    // 高さ 15 の橋を通って、人物の居るマスへ
    expect(pathProblems({ x: 1, y: 1, facing: "down" }, [walk("down"), walk("right")], world)).toEqual([{ index: 1, reason: "person", x: 2, y: 2 }]);
  });

  it("1 つ戻す・やり直す・全部消す", () => {
    const ops = new PathOps();
    ops.push(walk("up"), walk("up"));
    ops.push(walk("left"));
    expect(ops.undo()).toBe(true);
    expect(pathToMovement(ops.ops)).toEqual([0x11, 0x11]);
    expect(ops.redo()).toBe(true);
    expect(pathToMovement(ops.ops)).toEqual([0x11, 0x11, 0x12]);
    ops.clear();
    expect(ops.ops).toEqual([]);
    expect(ops.redo()).toBe(true);
    expect(ops.ops.length).toBe(3);
    ops.undo();
    ops.push(walk("down"));
    expect(ops.canRedo).toBe(false);
  });

  it("作った列を再生すると、なぞった道を歩く", () => {
    const XSE = ".macro applymovement index:req, movements:req\n.byte 0x4f\n.2byte \\index\n.4byte \\movements\n.endm\n.macro waitmovement index:req\n.byte 0x51\n.2byte \\index\n.endm\n.macro end\n.byte 0x02\n.endm\n";
    const start = { x: 5, y: 5, facing: "down" as const };
    const ops: PathOp[] = [walk("right"), walk("right"), { kind: "face", direction: "up" }, { kind: "wait", frames: 6 }, walk("up", 0x1d), walk("left", 0x08), walk("down")];
    const values = pathToMovement(ops);
    const text = `Main:\n\tapplymovement 1 m\n\twaitmovement 0\n\tend\nm: .byte ${values.map((v) => `0x${v.toString(16)}`).join(", ")}, 0xfe\n`;
    const index = new ScriptIndex();
    index.updateFile("a.s", text);
    const commands = ScriptCommandTable.build({ xseCommands: XSE });
    const actor = (id: number, x: number, y: number) => ({ id, graphicsId: 5, x, y, elevation: 3, facing: "down" as const, defaultFacing: "down" as const });
    const t = simulatePlayback({ project: { index, commands, text: (p) => (p === "a.s" ? text : null) }, entry: "Main", start: { actors: [actor(PLAYER_ID, 0, 0), actor(1, start.x, start.y)], talker: null } });
    const trace = tracePath(start, ops);
    const walks = trace.steps.filter((s) => s.op.kind === "walk").map((s) => [s.to.x, s.to.y]);
    const moved = t.segments.filter((s) => movementAction(s.movementId).kind === "walk").map((s) => [s.toX, s.toY]);
    expect(moved).toEqual(walks);
    const last = t.stateAt(t.lastFrame).actors.find((a) => a.id === 1)!;
    expect([last.tileX, last.tileY, last.facing]).toEqual([trace.end.x, trace.end.y, trace.end.facing]);
  });
});
