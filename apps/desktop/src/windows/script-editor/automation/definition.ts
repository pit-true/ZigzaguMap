import { settle } from "../../../app/automation/registry";
import { definitionAt, goToDefinition } from "../extensions/definition";
import { ctxOf, lineColumn, messageText, needPos, type EditorCommandTable } from "./common";

/** 定義へ移動と戻る（`editor.definition` / `editor.back`）。 */
export const definitionCommands: EditorCommandTable = {
  "editor.definition": async (w, req) => {
    const p = needPos(w, req);
    const ctx = ctxOf(w);
    const d = definitionAt(ctx, w.view.state, p);
    let moved = false;
    if (req["go"] === true) moved = await goToDefinition(ctx, w.view, p);
    await settle(100);
    return {
      definition: d ? { kind: d.kind, name: d.name, targets: d.targets } : null,
      moved,
      active: w.active?.path ?? null,
      cursor: w.active ? lineColumn(w.view.state, w.view.state.selection.main.head) : null,
      back: w.backDepth,
      message: messageText(),
    };
  },

  "editor.back": async (w) => {
    const ok = await w.back();
    return { moved: ok, active: w.active?.path ?? null, cursor: w.active ? lineColumn(w.view.state, w.view.state.selection.main.head) : null, back: w.backDepth };
  },
};
