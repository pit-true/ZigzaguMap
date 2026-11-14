import { history } from "@codemirror/commands";
import type { EditorExtensionFactory } from "./context";

/** 元に戻す・やり直す（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）の履歴。ファイル（タブ）ごとに持つ。キーは keymap.ts。 */
export const historyExtension: EditorExtensionFactory = () => history();
