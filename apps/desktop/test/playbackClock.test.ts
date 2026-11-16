import { expect, it } from "vitest";
import { PlaybackClock } from "../src/ui/playback/PlaybackClock";

it("動きの前・中・後へ進み、同じ点を戻る", () => {
  const clock = new PlaybackClock(15, [0, 8, 15]);
  clock.step(1); expect(clock.frame).toBe(8);
  clock.step(1); expect(clock.frame).toBe(15);
  clock.step(-1); expect(clock.frame).toBe(8);
  clock.step(-1); expect(clock.frame).toBe(0);
  clock.step(-1); expect(clock.frame).toBe(0);
  clock.step(1, true); expect(clock.frame).toBe(1);
  clock.seek(100); expect(clock.frame).toBe(15);
});

it("速度によらず最後のフレームへ到達し、停止中の経過を加えない", () => {
  for (const speed of [0.25, 0.5, 1, 2, 4]) {
    const clock = new PlaybackClock(60, [0, 30, 60]);
    clock.setSpeed(speed); clock.play(); clock.tick(0);
    let time = 0;
    while (clock.playing) { time += 10; clock.tick(time); }
    expect(clock.frame).toBe(60);
    clock.seek(10); clock.tick(time + 1000); expect(clock.frame).toBe(10);
    clock.play(); clock.tick(time + 2000); expect(clock.frame).toBe(10);
  }
});

it("メッセージで止まり、再開すると続きから進む", () => {
  const clock = new PlaybackClock(100, []);
  clock.play(); clock.tick(0, 5); clock.tick(200, 5);
  expect(clock.frame).toBe(5); expect(clock.playing).toBe(false);
  clock.play(); clock.tick(1000); clock.tick(1100);
  expect(clock.frame).toBe(11);
  expect(() => clock.seek(NaN)).toThrow();
  expect(() => clock.setSpeed(3)).toThrow();
});

it("非表示から戻ったときの大きな時間差を制限する", () => {
  const clock = new PlaybackClock(1000, []);
  clock.play(); clock.tick(0); clock.tick(100_000);
  expect(clock.frame).toBe(15);
  clock.tick(90_000); expect(clock.frame).toBe(15);
});
