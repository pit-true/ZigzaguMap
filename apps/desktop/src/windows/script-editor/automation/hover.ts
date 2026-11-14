import { settle } from "../../../app/automation/registry";
import { hoverAt, showPinnedHover } from "../extensions/hover";
import { closePinnedTooltip } from "../extensions/pinned";
import { hoverPlainText } from "../hoverContent";
import { ctxOf, lineColumn, needPos, type EditorCommandTable } from "./common";

/** ホバー（`editor.hover` / `editor.closeHover`）。 */
export const hoverCommands: EditorCommandTable = {
  "editor.hover": async (w, req) => {
    const p = needPos(w, req);
    const ctx = ctxOf(w);
    const info = req["show"] === true ? showPinnedHover(w.view, ctx, p) : hoverAt(ctx, w.view.state, p);
    if (req["show"] === true) await settle(200);
    if (!info) return null;
    return {
      type: info.hover.type,
      from: lineColumn(w.view.state, info.from),
      to: lineColumn(w.view.state, info.to),
      text: w.view.state.sliceDoc(info.from, info.to),
      markdown: info.markdown,
      plain: hoverPlainText(info.markdown),
      shown: req["show"] === true ? document.querySelector('[data-auto-id="se.hover"]') !== null : false,
    };
  },

  "editor.closeHover": (w) => ({ closed: w.active ? closePinnedTooltip(w.view) : false }),
};
