import { listDialogs } from "../../../app/automation/dialogs";
import { settle } from "../../../app/automation/registry";
import type { EditorCommandTable } from "./common";

/** ビルドの欄（`build.run` / `build.state` / `build.log` / `build.stop`）。 */
export const buildCommands: EditorCommandTable = {
  "build.run": async (w, req) => {
    // 動かし始めて返す（`wait: true` なら終わるまで待つ）。保存・出力の確認のダイアログが出たらそこで返る
    const running = w.build.run({ skipConfirm: req["confirm"] === false });
    if (req["wait"] === true) await running;
    else await Promise.race([running, settle(500)]);
    return { ...w.build.status, dialogs: listDialogs() };
  },
  "build.state": (w) => w.build.status,
  "build.log": (w, req) => ({ lines: w.build.lines(typeof req["from"] === "number" ? req["from"] : 0) }),
  "build.stop": async (w) => {
    await w.build.stop();
    return w.build.status;
  },
};
