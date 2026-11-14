import { findMaps } from "../mapFind";
import { mapSearchName } from "../MapTreeModel";
import type { App } from "../App";
import { optStr, str, type CommandTable } from "./registry";

/**
 * マップの履歴と、マップ名で探す（#237）。戻る・進むは `action` の `view.back`・`view.forward`（マウスのサイドボタンは
 * `mouse` の `button: "back"` / `"forward"`）、探す窓は `action` の `map.find`。
 */
export const historyCommands: CommandTable = {
  "history.state": (app: App) => {
    const h = app.state.history;
    return { current: app.state.map?.id ?? null, ...h.snapshot(), canBack: h.canBack, canForward: h.canForward };
  },
  mapFind: async (app: App, req) => {
    const session = app.state.session;
    if (!session) throw new Error("ROM を開いていません");
    const candidates = findMaps(
      session.catalog.maps.map((m) => ({ id: m.id, name: mapSearchName(m) })),
      str(req, "query"),
    );
    // `open` に true を付けると先頭の候補を開く（探す窓で Enter を押したときと同じ）
    if (req["open"] === true && candidates[0]) await app.openMap(candidates[0].id);
    return { candidates, opened: req["open"] === true ? (candidates[0]?.id ?? null) : null };
  },
  "tree.filter": (app: App, req) => {
    const text = optStr(req, "text") ?? "";
    app.treeFilter.input.value = text;
    app.treeFilter.input.dispatchEvent(new Event("input"));
    return { filter: text, items: app.tree.items().length };
  },
};
