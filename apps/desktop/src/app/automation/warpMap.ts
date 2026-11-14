import type { App } from "../App";
import { int, type CommandTable } from "./registry";

/**
 * ワープの「行き先のマップを作る」（#241）。`warp.samples` は見本の一覧、`warp.createMap` は窓を出さずに作る
 * （`sample` は見本の番号か null、`copyLayout`、`bank`）。右クリックのメニューからは `contextMenu.press` の `createWarpMap`。
 */
export const warpMapCommands: CommandTable = {
  "warp.samples": async (app: App, req) => ({ samples: await (await app.warpMapCreator()).samples(int(req, "index")) }),
  "warp.createMap": async (app: App, req) => {
    const creator = await app.warpMapCreator();
    const sample = req["sample"] === null || req["sample"] === undefined ? null : int(req, "sample");
    const target = await creator.run(int(req, "index"), {
      sample,
      copyLayout: req["copyLayout"] !== false,
      ...(typeof req["bank"] === "number" ? { bank: req["bank"] } : {}),
    });
    return { target, map: app.state.map?.id ?? null, status: app.state.status.left };
  },
};
