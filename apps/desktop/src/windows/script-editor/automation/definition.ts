import { listDialogs } from "../../../app/automation/dialogs";
import { settle, waitAtMost } from "../../../app/automation/registry";
import { definitionAt, goToDefinition } from "../extensions/definition";
import { ctxOf, lineColumn, messageText, needPos, type EditorCommandTable } from "./common";

/** 定義へ移動と戻る（`editor.definition` / `editor.back`）。 */
export const definitionCommands: EditorCommandTable = {
  "editor.definition": async (w, req) => {
    const p = needPos(w, req);
    const ctx = ctxOf(w);
    const d = definitionAt(ctx, w.view.state, p);
    let moved = false;
    // 行き先のファイルを開けないときは、ダイアログを出したまま返す（`editor.open` と同じ。#380）
    if (req["go"] === true) moved = (await waitAtMost(goToDefinition(ctx, w.view, p), 1500)) === true;
    await settle(100);
    return {
      definition: d ? { kind: d.kind, name: d.name, targets: d.targets } : null,
      moved,
      active: w.active?.path ?? null,
      cursor: w.active ? lineColumn(w.view.state, w.view.state.selection.main.head) : null,
      back: w.backDepth,
      message: messageText(),
      dialogs: listDialogs(),
    };
  },

  "editor.back": async (w) => {
    // 戻る先のファイルを開けないときは、ダイアログを出したまま返す（#380）
    const ok = (await waitAtMost(w.back(), 1500)) === true;
    return { moved: ok, dialogs: listDialogs(), active: w.active?.path ?? null, cursor: w.active ? lineColumn(w.view.state, w.view.state.selection.main.head) : null, back: w.backDepth };
  },
};
