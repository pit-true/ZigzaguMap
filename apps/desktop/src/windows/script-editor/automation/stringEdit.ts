import { settle, str } from "../../../app/automation/registry";
import { openStringEditor } from "../extensions/stringEdit";
import { ctxOf, needPos, type EditorCommandTable } from "./common";

/** 文字列の本文の編集（`editor.stringEdit`）。 */
export const stringEditCommands: EditorCommandTable = {
  "editor.stringEdit": async (w, req) => {
    await w.project.load();
    if (req["open"] === true) {
      const p = needPos(w, req);
      openStringEditor(w.view, ctxOf(w), str(req, "label"), p);
      await settle(200);
      return { shown: document.querySelector('[data-auto-id="se.stringEdit"]') !== null };
    }
    const path = await w.editStringBody(str(req, "label"), str(req, "text"));
    const tab = path ? w.tabs.find((x) => x.path === path) : null;
    return { path, dirty: tab?.dirty ?? false, active: w.active?.path ?? null, tabs: w.tabs.map((x) => ({ path: x.path, dirty: x.dirty })) };
  },
};
