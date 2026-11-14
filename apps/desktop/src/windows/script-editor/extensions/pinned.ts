import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/**
 * マウスを離しても消えない吹き出し（自動操作で出すホバーと、文字列の本文の入力欄に使う）。
 * 本文を変える・Esc・吹き出しの外をクリックすると消える。
 */
export const setPinnedTooltip = StateEffect.define<Tooltip | null>();

export const pinnedTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPinnedTooltip)) return e.value;
    if (value && tr.docChanged) return null;
    return value;
  },
  provide: (f) => showTooltip.from(f),
});

/** 吹き出しを閉じる。出ていなければ false。 */
export function closePinnedTooltip(view: EditorView): boolean {
  if (!view.state.field(pinnedTooltipField, false)) return false;
  view.dispatch({ effects: setPinnedTooltip.of(null) });
  return true;
}

export const pinnedExtension: EditorExtensionFactory = () => [
  pinnedTooltipField,
  keymap.of([{ key: "Escape", run: closePinnedTooltip }]),
  EditorView.domEventHandlers({
    mousedown: (_e, view) => {
      if (view.state.field(pinnedTooltipField, false)) view.dispatch({ effects: setPinnedTooltip.of(null) });
      return false;
    },
  }),
];
