import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { PlaybackHighlightSpan } from "../protocol";

export const playbackHighlightEffect = StateEffect.define<readonly PlaybackHighlightSpan[]>();
export const playbackHighlightField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) if (effect.is(playbackHighlightEffect)) {
      const ranges: Range<Decoration>[] = [], lines = new Set<number>(), marks = new Set<string>();
      for (const span of effect.value) {
        if (!Number.isInteger(span.line) || span.line < 0 || span.line >= transaction.state.doc.lines) continue;
        const line = transaction.state.doc.line(span.line + 1);
        if (!lines.has(line.from)) { lines.add(line.from); ranges.push(Decoration.line({ class: "cm-playback-line" }).range(line.from)); }
        const from = line.from + Math.max(0, Math.min(line.length, span.start));
        const to = line.from + Math.max(0, Math.min(line.length, span.end));
        if (to > from && !marks.has(`${from}:${to}`)) { marks.add(`${from}:${to}`); ranges.push(Decoration.mark({ class: "cm-playback-value" }).range(from, to)); }
      }
      value = Decoration.set(ranges, true);
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

/** 自動操作でも、実際に装飾されている範囲を読む。 */
export function playbackHighlightRanges(state: EditorState): readonly { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  state.field(playbackHighlightField, false)?.between(0, state.doc.length, (from, to) => { if (to > from) out.push({ from, to }); });
  return out;
}
