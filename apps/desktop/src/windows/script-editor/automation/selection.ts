import { EditorSelection, type SelectionRange } from "@codemirror/state";
import { describeSelection, positionOf, requireActive, type EditorCommandTable, type Req } from "./common";

/** 選択（`editor.select`。範囲・複数の範囲・矩形）。 */
export const selectionCommands: EditorCommandTable = {
  "editor.select": (w, req) => {
    // 範囲 1 つ（line/column〜toLine/toColumn）、複数の範囲（ranges）、矩形（rect: { line, column, toLine, toColumn }）
    requireActive(w);
    const state = w.view.state;
    let ranges: SelectionRange[] = [];
    if (Array.isArray(req["ranges"])) {
      for (const r of req["ranges"] as Req[]) {
        const a = positionOf(state, r);
        if (a === null) throw new Error("ranges の要素には line（と column）か offset が要ります");
        ranges.push(EditorSelection.range(a, positionOf(state, r, "to") ?? a));
      }
    } else if (typeof req["rect"] === "object" && req["rect"] !== null) {
      const r = req["rect"] as Req;
      const l1 = Number(r["line"]);
      const l2 = Number(r["toLine"]);
      const c1 = Number(r["column"] ?? 1);
      const c2 = Number(r["toColumn"] ?? c1);
      for (let n = Math.min(l1, l2); n <= Math.max(l1, l2); n++) {
        const line = state.doc.line(Math.max(1, Math.min(state.doc.lines, n)));
        const a = Math.min(line.to, line.from + Math.min(c1, c2) - 1);
        const b = Math.min(line.to, line.from + Math.max(c1, c2) - 1);
        ranges.push(EditorSelection.range(a, b));
      }
    } else {
      const a = positionOf(state, req);
      if (a === null) throw new Error("line（と column）か offset、ranges、rect のどれかを指定してください");
      ranges = [EditorSelection.range(a, positionOf(state, req, "to") ?? a)];
      if (req["add"] === true) ranges = [...state.selection.ranges, ...ranges];
    }
    w.view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true });
    w.view.focus();
    return { selection: describeSelection(w.view.state) };
  },
};
