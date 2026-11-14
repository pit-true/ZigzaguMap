import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  searchPanelOpen,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import type { Command } from "@codemirror/view";
import { settle } from "../../../app/automation/registry";
import { describeSelection, lineColumn, requireActive, type EditorCommandTable } from "./common";

/** 検索と置換（`editor.search`）。 */
export const searchCommands: EditorCommandTable = {
  "editor.search": async (w, req) => {
    requireActive(w);
    const view = w.view;
    const action = typeof req["action"] === "string" ? req["action"] : "find";
    if (action === "close") {
      closeSearchPanel(view);
      return { open: searchPanelOpen(view.state) };
    }
    if (!searchPanelOpen(view.state)) openSearchPanel(view);
    const old = getSearchQuery(view.state);
    const query = new SearchQuery({
      search: typeof req["query"] === "string" ? req["query"] : old.search,
      replace: typeof req["replace"] === "string" ? req["replace"] : old.replace,
      regexp: typeof req["regexp"] === "boolean" ? req["regexp"] : old.regexp,
      caseSensitive: typeof req["caseSensitive"] === "boolean" ? req["caseSensitive"] : old.caseSensitive,
      wholeWord: typeof req["wholeWord"] === "boolean" ? req["wholeWord"] : old.wholeWord,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
    const run: Record<string, Command> = { next: findNext, previous: findPrevious, replace: replaceNext, replaceAll, selectAll: selectMatches };
    if (action !== "find" && action !== "open") {
      const cmd = run[action];
      if (!cmd) throw new Error(`知らない action です: ${action}`);
      cmd(view);
    }
    await settle(100);
    const matches: unknown[] = [];
    if (query.valid) {
      const cursor = query.getCursor(view.state);
      for (let m = cursor.next(); !m.done && matches.length < 500; m = cursor.next()) {
        matches.push({ ...lineColumn(view.state, m.value.from), text: view.state.sliceDoc(m.value.from, m.value.to) });
      }
    }
    return { open: searchPanelOpen(view.state), valid: query.valid, count: matches.length, matches, selection: describeSelection(view.state), dirty: w.active!.dirty };
  },
};
