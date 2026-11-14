import type { ScriptTarget } from "../../ui/script/ScriptEntry";
import { int, optStr, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * スクリプトエディタをメインから開く（`script.open` / `script.resolve`）。
 * エディタのウィンドウの中の操作は `"window": "script-editor"` で送る（windows/script-editor/automation.ts）。
 */

const KINDS: readonly ScriptTarget["kind"][] = ["person", "sign", "trap", "map"];

function target(req: AutomationRequest): ScriptTarget {
  const kind = str(req, "kind");
  if (!(KINDS as readonly string[]).includes(kind)) throw new Error(`kind は ${KINDS.join(" / ")} のどれかです: ${kind}`);
  return { map: { bank: int(req, "bank"), map: int(req, "map") }, kind: kind as ScriptTarget["kind"], index: typeof req["index"] === "number" ? req["index"] : 0 };
}

export const scriptCommands: CommandTable = {
  "script.open": async (app, req) => {
    // `path`（と `line`）でファイルを、`bank`・`map`・`kind`・`index` でイベントのスクリプトを開く
    const host = await app.scriptHost();
    const path = optStr(req, "path");
    if (path !== null) {
      const opened = await host.openFile(path, typeof req["line"] === "number" ? req["line"] : undefined);
      return { opened, path, status: app.state.status };
    }
    const location = await host.openTarget(target(req));
    return { opened: location !== null, location, status: app.state.status };
  },
  "script.resolve": async (app, req) => (await app.scriptHost()).resolve(target(req)),
};
