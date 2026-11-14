import { USAGE_KINDS, type UsageKind } from "@zigzagumap/core";
import type { App } from "../App";
import { int, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * 使われている番号の索引（#227）。`usage.state`（作り終えたか・件数・かかった時間）、`usage.next`（未使用の最小）、
 * `usage.find`（その番号を使っている場所）。`usage.next` と `usage.find` は索引を作り終えるまで待つ。
 */

function kind(req: AutomationRequest): UsageKind {
  const v = str(req, "kind");
  if (!(USAGE_KINDS as readonly string[]).includes(v)) throw new Error(`kind は ${USAGE_KINDS.join(" / ")} のどれかです`);
  return v as UsageKind;
}

export const usageCommands: CommandTable = {
  "usage.state": async (app: App, req) => {
    if (req["wait"] === true) await app.usage.ensure();
    return app.usage.state();
  },
  "usage.next": async (app: App, req) => ({ kind: kind(req), value: await app.usage.next(kind(req)) }),
  "usage.find": async (app: App, req) => ({ kind: kind(req), value: int(req, "value"), sites: await app.usage.find(kind(req), int(req, "value")) }),
};
