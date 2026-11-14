import { stampFits } from "@zigzagumap/core";
import { MapTab } from "../../ui/tabs/MapTab";
import type { App } from "../App";
import { str, type CommandTable } from "./registry";

/**
 * スタンプ（#239）。`stamps.list` は全部と今のマップに貼れるもの、`stamps.save` は今の選択を保存（名前を聞かない）、
 * `stamps.select` は一覧の項目を押すのと同じ、`stamps.rename`・`stamps.remove` は右クリックのメニューと同じ（聞かない）。
 */
function mapTab(app: App): MapTab {
  const tab = (app.tabs as unknown as Record<string, unknown>)["map"];
  if (!(tab instanceof MapTab)) throw new Error("マップタブがありません");
  return tab;
}

async function list(app: App) {
  const session = app.state.session;
  if (!session) throw new Error("ROM を開いていません");
  const lib = await session.stamps();
  const map = app.state.map;
  const describe = (s: ReturnType<typeof lib.list>[number]) => ({
    name: s.name,
    width: s.width,
    height: s.height,
    primaryTileset: s.primaryTileset,
    secondaryTileset: s.secondaryTileset,
    secondaryUsed: s.secondaryUsed,
    withMovements: s.withMovements,
    path: lib.pathOf(s.name),
    fits: map ? stampFits(s, map.doc.primaryTileset, map.doc.secondaryTileset) : false,
  });
  const shown = [...document.querySelectorAll<HTMLElement>(".stamp-item")].map((li) => li.dataset["name"] ?? "");
  return {
    all: lib.list().map(describe),
    fitting: map ? lib.fitting(map.doc.primaryTileset, map.doc.secondaryTileset).map((s) => s.name) : [],
    shown,
    memoryOnly: lib.fs === null,
    pending: lib.pendingCount,
    problems: lib.problems,
  };
}

export const stampCommands: CommandTable = {
  "stamps.list": (app) => list(app),
  "stamps.save": async (app, req) => {
    const ok = await mapTab(app).stamps.saveSelection(str(req, "name"), req["overwrite"] === true);
    return { ok, ...(await list(app)) };
  },
  "stamps.select": async (app, req) => {
    const ok = await mapTab(app).stamps.select(str(req, "name"));
    return { ok, selection: app.state.selection };
  },
  "stamps.rename": async (app, req) => ({ ok: await mapTab(app).stamps.rename(str(req, "name"), str(req, "to")), ...(await list(app)) }),
  "stamps.remove": async (app, req) => ({ ok: await mapTab(app).stamps.remove(str(req, "name"), false), ...(await list(app)) }),
};
