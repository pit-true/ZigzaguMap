import type { Extension } from "@codemirror/state";
import { basicExtension } from "./basic";
import { completionExtension } from "./completion";
import { definitionExtension } from "./definition";
import { editingExtension } from "./editing";
import { semanticHighlightExtension } from "./highlight";
import { hoverExtension } from "./hover";
import { languageExtension } from "./language";
import { lintExtension } from "./lint";
import { phrasesExtension } from "./phrases";
import { pinnedExtension } from "./pinned";
import { searchExtension } from "./search";
import { stringEditExtension } from "./stringEdit";
import { stringLinesExtension } from "./stringLines";
import { themesExtension } from "./themes";
import type { EditorExtensionFactory, EditorFileContext } from "./context";
import { historyExtension } from "./history";
import { keymapExtension } from "./keymap";
import { lineNumbersExtension } from "./lineNumbers";
import { plainThemeExtension } from "./theme";
import { renameExtension } from "./rename";

export type { EditorExtensionFactory, EditorFileContext } from "./context";

/**
 * エディタの機能の一覧。機能を足すときは、このフォルダに 1 ファイル作り（EditorExtensionFactory を 1 つ export）、
 * ここに 1 行足す。同じ優先度の拡張は上にあるものが先に処理される（キー操作は、上の keymap のキーが先に調べられる）。
 * 後の issue が並行で足しても重なりにくいよう、1 機能 1 行で書き、行の順は「キー → 履歴 → 表示 → 見た目」にする。
 */
export const EDITOR_EXTENSIONS: readonly EditorExtensionFactory[] = [
  keymapExtension,
  renameExtension,
  definitionExtension,
  searchExtension,
  completionExtension,
  lintExtension,
  historyExtension,
  basicExtension,
  editingExtension,
  languageExtension,
  semanticHighlightExtension,
  hoverExtension,
  pinnedExtension,
  stringEditExtension,
  stringLinesExtension,
  lineNumbersExtension,
  phrasesExtension,
  plainThemeExtension,
  themesExtension,
];

/** ファイル 1 つ分の拡張を作る。 */
export function buildExtensions(ctx: EditorFileContext): Extension[] {
  return EDITOR_EXTENSIONS.map((make) => make(ctx));
}
