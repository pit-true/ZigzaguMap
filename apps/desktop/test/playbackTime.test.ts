import { expect, it } from "vitest";
import type { TimeOfDay } from "@zigzagumap/core";
import { PlaybackTime } from "../src/ui/playback/PlaybackTime";

it("マーカーより前へ戻ると元の色に戻し、終了時にも復元する", async () => {
  const changed: TimeOfDay[] = [];
  const clock = new PlaybackTime({ time: "evening", chronosTime: async value => value === 1 ? "morning" : null, set: async time => { changed.push(time); return true; } }, () => true);
  const markers = [{ frame: 10, kind: "timeOfDay" as const, detail: "1" }];
  clock.update(markers, 10); await clock.ready();
  clock.update(markers, 9); await clock.ready();
  clock.update(markers, 10); await clock.ready();
  await clock.stop();
  expect(changed).toEqual(["morning", "evening", "morning", "evening"]);
});

it("読み込みが遅れて返っても、巻き戻した後の色を上書きしない", async () => {
  let complete!: (value: TimeOfDay) => void;
  const reading = new Promise<TimeOfDay>(resolve => { complete = resolve; });
  const changed: TimeOfDay[] = [];
  const clock = new PlaybackTime({ time: "day", chronosTime: () => reading, set: async time => { changed.push(time); return true; } }, () => true);
  const markers = [{ frame: 10, kind: "timeOfDay" as const, detail: "3" }];
  clock.update(markers, 10);
  await Promise.resolve(); await Promise.resolve();
  clock.update(markers, 0);
  complete("night"); await clock.ready();
  expect(changed).toEqual(["day"]);
});

it("セッションを替えた場合は元のセッションの色を適用しない", async () => {
  let valid = true;
  const changed: TimeOfDay[] = [];
  const clock = new PlaybackTime({ time: "night", chronosTime: async () => "morning", set: async time => { changed.push(time); return true; } }, () => valid);
  valid = false;
  clock.update([{ frame: 0, kind: "timeOfDay", detail: "1" }], 0); await clock.stop();
  expect(changed).toEqual([]);
});
