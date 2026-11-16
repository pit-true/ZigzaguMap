import type { TimeOfDay } from "@zigzagumap/core";
import type { App } from "../App";
import { TIME_IDS } from "../timeOfDay/TimeOfDayView";
import type { AutomationRequest, CommandTable } from "./registry";

/**
 * `view.timeOfDay {time?, settimeofday?, wait?}`: 時間帯ビューア（Phase6 #434）。
 * - `time`（`morning` / `day` / `evening` / `night`）か、`settimeofday`（Chronos の値。0 昼・1 朝・2 夕・3 夜・4 深夜。深夜は夜）で切り替える。
 *   どちらも無ければ切り替えずに今の状態を返す。`wait: true` なら隣の帯を描き終えるまで待つ。
 * - スクリプトの再生（P6-A）が `settimeofday` を再現するときも、これと同じ `TimeOfDayView.set` を呼ぶ。
 */
async function timeOfDay(app: App, req: AutomationRequest): Promise<unknown> {
  const view = app.timeOfDay;
  let ok = true;
  if (typeof req["time"] === "string") ok = await view.set(req["time"] as TimeOfDay);
  else if (typeof req["settimeofday"] === "number") {
    const time = await view.chronosTime(req["settimeofday"]);
    if (time === null) throw new Error(view.lastError ?? `settimeofday の値を時間帯に直せません: ${req["settimeofday"]}`);
    ok = await view.set(time);
  }
  if (req["wait"] === true) await app.extras.neighbors.settle();
  const config = view.time === "day" ? null : await view.config();
  const tint = view.tint;
  return {
    ok,
    time: view.time,
    times: TIME_IDS,
    error: view.lastError,
    // 区分の代表の時刻と時刻の元（読み込んでいなければ null）
    sections: config?.sections ?? null,
    clock: config?.clock ?? null,
    // 表示中のマップの色が変わるか（屋内などは false）と、使った色（昼なら null）
    mapTinted: view.mapTinted(),
    fade: tint?.fade ?? null,
    // 最後の切り替えの描き直しの時間（主マップの分。ミリ秒）
    switchMs: Math.round(view.lastSwitchMs * 10) / 10,
    combo: { value: view.select.value, disabled: view.select.disabled },
    status: app.state.status.left,
  };
}

export const timeOfDayCommands: CommandTable = {
  "view.timeOfDay": timeOfDay,
};
