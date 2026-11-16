import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { playbackHighlightEffect, playbackHighlightField, playbackHighlightRanges } from "../src/windows/script-editor/extensions/playbackHighlight";

it("複数行と値の範囲を本文・選択範囲を変えずに強調し、終了時に外す", () => {
  const state = EditorState.create({ doc: "applymovement 1, Walk\nWalk: .byte walk_up, end_m", extensions: [playbackHighlightField], selection: { anchor: 3 } });
  const spans = [{ path: "a.s", line: 0, start: 0, end: 13 }, { path: "a.s", line: 1, start: 12, end: 19 }];
  const highlighted = state.update({ effects: playbackHighlightEffect.of([...spans, spans[0]!]) }).state;
  expect(playbackHighlightRanges(highlighted).map(range => highlighted.sliceDoc(range.from, range.to))).toEqual(["applymovement", "walk_up"]);
  expect(highlighted.doc).toBe(state.doc); expect(highlighted.selection).toBe(state.selection);
  const stopped = highlighted.update({ effects: playbackHighlightEffect.of([]) }).state;
  expect(playbackHighlightRanges(stopped)).toEqual([]); expect(stopped.doc).toBe(state.doc);
});

it("本文を編集したら古い位置の強調を捨て、範囲外の行は読まない", () => {
  const state = EditorState.create({ doc: "end", extensions: [playbackHighlightField] });
  const spans = [{ path: "a.s", line: 0, start: 0, end: 100 }, { path: "a.s", line: 99, start: 0, end: 3 }];
  const highlighted = state.update({ effects: playbackHighlightEffect.of(spans) }).state;
  expect(playbackHighlightRanges(highlighted)).toEqual([{ from: 0, to: 3 }]);
  const changed = highlighted.update({ changes: { from: 0, insert: "@ " } }).state;
  expect(playbackHighlightRanges(changed)).toEqual([]);
});
