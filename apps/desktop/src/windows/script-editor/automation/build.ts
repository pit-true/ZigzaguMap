import { listDialogs, untilDialog } from "../../../app/automation/dialogs";
import { settle } from "../../../app/automation/registry";
import type { EditorCommandTable } from "./common";

/** ビルドの欄（`build.run` / `build.state` / `build.log` / `build.stop`）。 */
export const buildCommands: EditorCommandTable = {
  "build.run": async (w, req) => {
    // 動かし始めて返す（`wait: true` なら終わるまで待つ）。保存・出力の確認のダイアログが出たら、答えを待たずにそこで返る。
    // 設定を読めないときはダイアログを出さずにエラーで返す（#380）
    const start = (): Promise<boolean> => {
      const running = w.build.run({ skipConfirm: req["confirm"] === false, quiet: true });
      // 確認に答えたあとで設定を読めなかったときは、返事を返したあとなので、ログに残す
      running.catch((e: unknown) => w.build.note(e));
      return running;
    };
    if (req["wait"] === true) await untilDialog(start);
    else await Promise.race([start(), settle(500)]);
    return { ...w.build.status, dialogs: listDialogs() };
  },
  "build.state": (w) => w.build.status,
  "build.log": (w, req) => ({ lines: w.build.lines(typeof req["from"] === "number" ? req["from"] : 0) }),
  "build.stop": async (w) => {
    await w.build.stop();
    return w.build.status;
  },
};
