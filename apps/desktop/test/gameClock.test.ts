import { describe, expect, it } from "vitest";
import { GameClock, GBA_FRAME_MS, type ClockScheduler } from "../src/app/GameClock";

/** 手で進める requestAnimationFrame。 */
function manual() {
  let next = 1;
  const pending = new Map<number, (t: number) => void>();
  const scheduler: ClockScheduler = {
    request: (cb) => { const id = next++; pending.set(id, cb); return id; },
    cancel: (id) => { pending.delete(id); },
  };
  return {
    scheduler,
    get pending() { return pending.size; },
    fire(t: number) { const all = [...pending.values()]; pending.clear(); for (const cb of all) cb(t); },
  };
}

describe("GameClock", () => {
  it("購読が無ければ予約せず、購読すると GBA のフレームで進める", () => {
    const m = manual();
    const clock = new GameClock(m.scheduler);
    expect(m.pending).toBe(0);
    const got: number[] = [];
    const sub = clock.subscribe("npc", f => got.push(f));
    expect(m.pending).toBe(1);
    m.fire(1000);
    m.fire(1000 + GBA_FRAME_MS * 3 + 1);
    m.fire(1000 + GBA_FRAME_MS * 3.5);
    m.fire(1000 + GBA_FRAME_MS * 4 + 0.5);
    expect(got).toEqual([3, 1]);
    sub.dispose();
    expect(m.pending).toBe(0);
    expect(clock.running).toBe(false);
  });

  it("hold した間は予約しない。全部の解除で動き出し、間の時間は数えない", () => {
    const m = manual();
    const clock = new GameClock(m.scheduler);
    const got: number[] = [];
    const sub = clock.subscribe("npc", f => got.push(f));
    m.fire(0);
    const a = sub.hold("playback"), b = sub.hold("test");
    expect(m.pending).toBe(0);
    expect(sub.holders).toEqual(["playback", "test"]);
    a(); a();
    expect(m.pending).toBe(0);
    b();
    expect(m.pending).toBe(1);
    m.fire(100000);
    m.fire(100000 + GBA_FRAME_MS);
    expect(got).toEqual([1]);
  });

  it("長く間があいても 250ms 分まで", () => {
    const m = manual();
    const clock = new GameClock(m.scheduler);
    const got: number[] = [];
    clock.subscribe("tiles", f => got.push(f));
    m.fire(0);
    m.fire(60000);
    expect(got).toEqual([Math.floor(250 / GBA_FRAME_MS)]);
  });

  it("tick の中で購読をやめても二重に予約しない", () => {
    const m = manual();
    const clock = new GameClock(m.scheduler);
    const keep = clock.subscribe("a", () => undefined);
    const once = clock.subscribe("b", () => once.dispose());
    m.fire(0);
    m.fire(GBA_FRAME_MS * 2);
    expect(m.pending).toBe(1);
    keep.dispose();
    expect(m.pending).toBe(0);
  });
});
