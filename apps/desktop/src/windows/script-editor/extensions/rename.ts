import { keymap } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/** ラベルに使える字（GNU as のシンボル）。 */
const NAME_CHAR = /[A-Za-z0-9_.$]/;

/**
 * ラベル名の変更（F2。#203）。カーソルのある語（ラベル名）を、プロジェクトの `.s` の定義と参照ごと変える。
 * 実際の変更（ほかのファイルの書き換えと、メインへの知らせ）はウィンドウの `renameLabel` が行う。`.s` だけで使える。
 */
export const renameExtension: EditorExtensionFactory = (ctx) =>
  keymap.of([
    {
      key: "F2",
      preventDefault: true,
      run: (view) => {
        if (ctx.kind !== "asm" || !ctx.renameLabel) return false;
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        let from = pos - line.from;
        let to = from;
        while (from > 0 && NAME_CHAR.test(line.text[from - 1]!)) from--;
        while (to < line.text.length && NAME_CHAR.test(line.text[to]!)) to++;
        const word = line.text.slice(from, to);
        if (word === "" || /^[0-9]/.test(word)) return false;
        ctx.renameLabel(word);
        return true;
      },
    },
  ]);
