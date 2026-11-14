import { EditorState } from "@codemirror/state";
import { jaScriptEditorAssist as t } from "../../../i18n/ja.scriptEditorAssist";
import type { EditorExtensionFactory } from "./context";

/** CodeMirror の部品（検索の欄・補完・波線の一覧）の文言を日本語にする。 */
export const phrasesExtension: EditorExtensionFactory = () => EditorState.phrases.of(t.phrases);
