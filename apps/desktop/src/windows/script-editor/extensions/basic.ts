import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { drawSelection, highlightActiveLine, highlightSpecialChars } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/** 基本の表示: 選択の描画、複数の選択、今の行の強調、見えない文字の表示、字下げはタブ（.s の書き方に合わせる）。 */
export const basicExtension: EditorExtensionFactory = () => [
  highlightSpecialChars(),
  drawSelection(),
  EditorState.allowMultipleSelections.of(true),
  highlightActiveLine(),
  indentUnit.of("\t"),
  EditorState.tabSize.of(4),
];
