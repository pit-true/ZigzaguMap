import { EventTab } from "../../ui/event/EventTab";
import { KIND_ORDER, type UiKind } from "../../ui/event/eventModel";
import type { App } from "../App";
import { int, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * イベントタブ（`event.select` / `event.state`）。マップ上のマウス操作は `mouse`（target: event）。古い `event.mouse` は mouse.ts の別名。
 * 部品の ID は `event.kind`、`event.number`、`event.person.x` のような形（`event.<種別>.<欄>`）。
 */

function eventTab(app: App): EventTab {
  const tab = app.tabs.event;
  if (!(tab instanceof EventTab)) throw new Error("イベントタブがありません");
  return tab;
}

function kind(req: AutomationRequest): UiKind {
  const v = str(req, "kind");
  if (!(KIND_ORDER as readonly string[]).includes(v)) throw new Error(`kind は ${KIND_ORDER.join(" / ")} のどれかです`);
  return v as UiKind;
}

export const eventCommands: CommandTable = {
  "event.select": (app, req) => {
    const tab = eventTab(app);
    tab.select(kind(req), int(req, "index"));
    return tab.selection;
  },
  "event.state": (app) => {
    const tab = eventTab(app);
    const map = app.state.map;
    return {
      ...tab.selection,
      count: tab.count(),
      counts: tab.counts(),
      fly: tab.count("fly") > 0,
      events: map?.doc.events ?? null,
      itemBalls: map?.doc.itemBalls ?? [],
    };
  },
};
