import type { CommandTable } from "./registry";

/**
 * 天候のプレビュー（#498）。どれもマップ・ROM・履歴を変えない。
 * - `weather.state`: 表示しているか、選んだ天候、今の天候の番号、段と合成（evy・eva・evb）、絵の数、時計の購読、読んだ絵のバイト数。
 * - `weather.set {on?, weather?, seed?}`: プレビューする天候（`"map"` か 0〜14）を選び、表示のオン・オフ（`on`）を切り替える。
 *   `seed` は雪・雷・泡の乱数の種（オンにするときだけ）。
 * - `weather.tick {frames}`: 時計の代わりに進める（仮の主人公の画面が出ていて、再生中でないとき）。
 */
export const weatherCommands: CommandTable = {
  "weather.state": (app) => ({ entry: { enabled: app.weather.enabled, choice: app.weather.choice }, ...(app.weather.loaded?.info() ?? {}), clock: app.gameClock.state }),
  "weather.set": async (app, req) => {
    const weather = req["weather"];
    if (weather !== undefined) app.weather.choose(weather as "map" | number);
    if (req["on"] === true && !app.weather.enabled) await app.weather.start({ seed: typeof req["seed"] === "number" ? req["seed"] : 0 });
    else if (req["on"] === false) app.weather.stop();
    return { entry: { enabled: app.weather.enabled, choice: app.weather.choice }, ...(app.weather.loaded?.info() ?? {}) };
  },
  "weather.tick": (app, req) => {
    const frames = req["frames"];
    if (typeof frames !== "number" || frames < 0) throw new Error("frames は 0 以上の数です");
    app.weather.loaded?.tick(frames);
    return app.weather.loaded?.info() ?? { enabled: false };
  },
};
