import type { App } from "../App";
import { showError } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import { listDialogs, untilDialog } from "./dialogs";
import { int, type CommandTable } from "./registry";

/**
 * ワープの「行き先のマップを作る」（#241）。`warp.samples` は見本の一覧、`warp.createMap` は窓を出さずに作る
 * （`sample` は見本の番号か null、`copyLayout`、`bank`）。右クリックのメニューからは `contextMenu.press` の `createWarpMap`。
 * エラー（ワープが無い、バンクが範囲外・満杯など）はダイアログを出さずにエラーで返す。`bank` を省くと、バンクを聞く窓を
 * 出したまま返す（#380）。
 */
export const warpMapCommands: CommandTable = {
  "warp.samples": async (app: App, req) => ({ samples: await (await app.events.warpMapCreator()).samples(int(req, "index")) }),
  "warp.createMap": async (app: App, req) => {
    const creator = await app.events.warpMapCreator();
    const sample = req["sample"] === null || req["sample"] === undefined ? null : int(req, "sample");
    const bank = typeof req["bank"] === "number" ? req["bank"] : undefined;
    const index = int(req, "index");
    const start = () => creator.run(index, { sample, copyLayout: req["copyLayout"] !== false, quiet: true, ...(bank !== undefined ? { bank } : {}) });
    const reply = (target: unknown) => ({ target, map: app.state.map?.id ?? null, status: app.state.status.left, dialogs: listDialogs() });
    if (bank !== undefined) return reply(await start());
    // バンクを聞く窓が出たら、答えを待たずに返す。答えたあとのエラーは、画面からの操作と同じくダイアログで出す
    let running!: ReturnType<typeof start>;
    const done = await untilDialog(() => (running = start()).then((target) => ({ target })));
    if (done) return reply(done.target);
    running.catch((e: unknown) => void showError(errorText(e)));
    return reply(null);
  },
};
