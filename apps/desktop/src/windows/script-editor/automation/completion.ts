import { startCompletion } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import { settle } from "../../../app/automation/registry";
import { completionAt } from "../extensions/completion";
import { ctxOf, lineColumn, needPos, type EditorCommandTable } from "./common";

/** 補完（`editor.complete`）。 */
export const completionCommands: EditorCommandTable = {
  "editor.complete": async (w, req) => {
    const p = needPos(w, req);
    const ctx = ctxOf(w);
    const c = completionAt(ctx, w.view.state, p);
    if (req["show"] === true) {
      w.view.dispatch({ selection: EditorSelection.cursor(p) });
      w.view.focus();
      startCompletion(w.view);
      await settle(400);
    }
    if (!c) return null;
    const word = w.view.state.sliceDoc(c.lineFrom + c.from, p);
    const filter = typeof req["filter"] === "string" ? req["filter"] : word;
    const items = c.items.filter((i) => i.label.toLowerCase().startsWith(filter.toLowerCase()));
    const limit = typeof req["limit"] === "number" ? req["limit"] : 50;
    return {
      context: c.context,
      argIndex: c.argIndex,
      kind: c.kind,
      from: lineColumn(w.view.state, c.lineFrom + c.from),
      to: lineColumn(w.view.state, c.lineFrom + c.to),
      word,
      total: c.items.length,
      count: items.length,
      items: items.slice(0, limit).map((i) => ({ label: i.label, type: i.type, detail: i.detail ?? null })),
      shown: req["show"] === true ? document.querySelector(".cm-tooltip-autocomplete") !== null : false,
    };
  },
};
