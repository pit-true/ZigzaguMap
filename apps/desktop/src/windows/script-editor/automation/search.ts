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

/** 検索と置換（`editor.search`）と、全ファイル検索（`search.project`。#520）。 */
export const searchCommands: EditorCommandTable = {
  // 全ファイル検索の欄を開いて探す。text・caseSensitive・regexp・wholeWord・scope（all / asm / string）。省いたものは欄の値。
  // open に結果の行の番号（0 から、ファイルを並べた順に数えた行）を渡すと、その行を押す（開いてその行へ移る）
  "search.project": async (w, req) => {
    const panel = await w.openProjectSearch(false);
    const scope = req["scope"];
    if (scope !== undefined && scope !== "all" && scope !== "asm" && scope !== "string") throw new Error("scope は all / asm / string のいずれかです");
    const state = await panel.search({
      ...(typeof req["text"] === "string" ? { text: req["text"] } : {}),
      ...(typeof req["caseSensitive"] === "boolean" ? { caseSensitive: req["caseSensitive"] } : {}),
      ...(typeof req["regexp"] === "boolean" ? { regexp: req["regexp"] } : {}),
      ...(typeof req["wholeWord"] === "boolean" ? { wholeWord: req["wholeWord"] } : {}),
      ...(scope ? { scope } : {}),
    });
    await settle();
    return state;
  },
  "search.projectState": (w) => ({ open: w.projectSearch?.visible ?? false, state: w.projectSearch?.state ?? null }),
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
