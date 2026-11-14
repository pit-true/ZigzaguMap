import { EventTab } from "../../ui/event/EventTab";
import type { App } from "../App";
import { int, optStr, type AutomationRequest, type CommandTable } from "./registry";

/**
 * イベントのホバーの吹き出し（#226）。`event.hover` は待たずにその場で出し、中身ができるまで待って文を返す。
 * マウスの `hover`（`mouse` の `action: "hover"`）でも、0.4 秒止まれば同じ吹き出しが出る（`event.hover.state` で読む）。
 */

function eventTab(app: App): EventTab {
  const tab = app.tabs.event;
  if (!(tab instanceof EventTab)) throw new Error("イベントタブがありません");
  if (app.state.tab !== "event") throw new Error("先に tab で event を表示してください");
  return tab;
}

/** 吹き出しの中身を返事の形にする。 */
function describe(tab: EventTab, shown: boolean) {
  const c = tab.hoverTip.content;
  const lines = c.sections.flatMap((s) => [s.title, ...(s.warn ? [s.warn] : []), ...s.lines]);
  return { shown, visible: tab.hoverTip.visible, cell: c.cell && [c.cell.x, c.cell.y], sections: c.sections, text: lines.join("\n") };
}

/** マスの位置（`cell: [x, y]` か、`kind`・`index` のイベントの位置）。 */
function cellOf(app: App, req: AutomationRequest): { x: number; y: number } {
  const cell = req["cell"];
  if (Array.isArray(cell) && cell.length === 2) return { x: Number(cell[0]), y: Number(cell[1]) };
  const kind = optStr(req, "kind");
  const events = app.state.map?.doc.events;
  if (!kind || !events) throw new Error("cell か kind・index を指定してください");
  const index = int(req, "index");
  const list = kind === "person" ? events.persons : kind === "warp" ? events.warps : kind === "trap" ? events.traps : kind === "sign" ? events.signs : null;
  const e = list?.[index];
  if (!e) throw new Error(`${kind} ${index} はありません`);
  return { x: e.x, y: e.y };
}

export const hoverCommands: CommandTable = {
  "event.hover": async (app, req) => {
    const tab = eventTab(app);
    const cell = cellOf(app, req);
    const r = tab.view.stage.getBoundingClientRect();
    const size = tab.view.cellSize;
    const shown = await tab.hoverTip.showAt(cell, r.left + (cell.x + 0.5) * size, r.top + (cell.y + 0.5) * size);
    const out = describe(tab, shown);
    if (req["show"] === false) tab.hoverTip.hide();
    return out;
  },
  "event.hover.state": (app) => {
    const tab = app.tabs.event;
    if (!(tab instanceof EventTab)) throw new Error("イベントタブがありません");
    return describe(tab, tab.hoverTip.visible);
  },
  "event.hover.hide": (app) => {
    const tab = app.tabs.event;
    if (tab instanceof EventTab) tab.hoverTip.hide();
    return null;
  },
};
