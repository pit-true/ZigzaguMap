import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { keymap, type EditorView } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/**
 * 検索と置換（#194。`@codemirror/search`）。Ctrl+F で検索、Ctrl+H で置換の欄に移る。正規表現・大文字小文字・単語単位を選べる。
 * F3 / Shift+F3 で次・前、Ctrl+D で同じ文字列を選択に足す、Ctrl+Shift+L で同じ文字列をすべて選ぶ、Ctrl+Alt+G で行へ移動。
 * 選んだ文字列と同じものを薄く強調する。文言は phrases.ts で日本語にする。
 */

/** 置換の欄を開いて、そこへカーソルを置く。 */
function openReplace(view: EditorView): boolean {
  openSearchPanel(view);
  const field = view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
  if (field) {
    field.focus();
    field.select();
  }
  return true;
}

export const searchExtension: EditorExtensionFactory = () => [
  search({ top: true }),
  highlightSelectionMatches(),
  keymap.of([{ key: "Mod-h", preventDefault: true, run: openReplace }, ...searchKeymap]),
];

