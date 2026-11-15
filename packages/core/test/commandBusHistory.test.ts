import { describe, expect, it } from "vitest";
import { CommandBus } from "../src/command/CommandBus.js";
import type { Command } from "../src/command/Command.js";

/** 数を足すだけのコマンド（履歴の確認用）。 */
function add(log: number[], n: number): Command {
  return { name: "add", args: { n }, do: () => void log.push(n), undo: () => void log.pop() };
}

describe("CommandBus の履歴の位置（#402）", () => {
  it("goTo で戻す・進める。やり直せる分は次にやり直す順", () => {
    const log: number[] = [];
    const bus = new CommandBus({ grid: () => { throw new Error("使わない"); } });
    for (const n of [1, 2, 3, 4]) bus.execute(add(log, n));
    expect(bus.position).toBe(4);
    expect(bus.goTo(1)).toBe(3);
    expect(log).toEqual([1]);
    expect(bus.history().map((r) => r.args["n"])).toEqual([1]);
    expect(bus.redoHistory().map((r) => r.args["n"])).toEqual([2, 3, 4]);
    expect(bus.goTo(3)).toBe(2);
    expect(log).toEqual([1, 2, 3]);
    expect(bus.redoHistory().map((r) => r.args["n"])).toEqual([4]);
    expect(bus.goTo(0)).toBe(3);
    expect(log).toEqual([]);
    expect(bus.goTo(99)).toBe(4);
    expect(log).toEqual([1, 2, 3, 4]);
    expect(bus.goTo(-5)).toBe(4);
    expect(bus.position).toBe(0);
  });

  it("1 回ごとに購読者へ知らせる", () => {
    const log: number[] = [];
    const bus = new CommandBus({ grid: () => { throw new Error("使わない"); } });
    for (const n of [1, 2, 3]) bus.execute(add(log, n));
    const events: string[] = [];
    bus.subscribe((e) => events.push(e.type));
    bus.goTo(0);
    bus.goTo(2);
    expect(events).toEqual(["undo", "undo", "undo", "redo", "redo"]);
  });
});
