import { Prec, RangeSetBuilder, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parseStringFile } from "@zigzagumap/core";
import type { EditorExtensionFactory } from "./context";
import { stringEnterInsert } from "./stringInput";

/**
 * `.string` の複数行の本文（#221）。
 * - 制御記号（`\n` `\p` `\l` `\m`）のあとで改行した続きの行に印（左の線）を付ける。続きの行は、前の行と 1 つの文字列になる。
 * - Enter: 本文の行の途中で押したとき、カーソルの前が制御記号でなければ `\n` を補ってから改行する
 *   （そのまま改行すると、後ろが別の文字列になってしまうため）。カーソルの前が制御記号なら、字下げせずに改行するだけ。
 *   行の終わりで押したとき（制御記号で終わらない行）と Shift+Enter は、ふつうの改行（新しい `#org` を書くときなど）。
 */

const continued = Decoration.line({ class: "se-str-cont" });

function decorations(state: EditorState): DecorationSet {
  const file = parseStringFile(state.doc.toString());
  const builder = new RangeSetBuilder<Decoration>();
  for (const [i, line] of file.lines.entries()) {
    if (line.continued && i < state.doc.lines) {
      const at = state.doc.line(i + 1).from;
      builder.add(at, at, continued);
    }
  }
  return builder.finish();
}

const continuationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorations(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = decorations(u.state);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Enter の処理。ふつうの改行にするときは false。 */
function stringEnter(view: EditorView): boolean {
  const insert = stringEnterInsert(view.state);
  if (insert === null) return false;
  const pos = view.state.selection.main.head;
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, scrollIntoView: true, userEvent: "input" });
  return true;
}

export const stringLinesExtension: EditorExtensionFactory = (ctx) =>
  ctx.kind !== "string"
    ? []
    : [
        Prec.high(keymap.of([{ key: "Enter", run: stringEnter }])),
        continuationPlugin,
        EditorView.baseTheme({
          ".se-str-cont": { boxShadow: "inset 3px 0 0 var(--se-cont-mark, rgba(128, 128, 128, 0.45))" },
        }),
      ];
