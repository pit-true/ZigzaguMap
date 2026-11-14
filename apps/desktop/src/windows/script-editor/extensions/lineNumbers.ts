import { highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/** 行番号（今の行の番号も強調する）。 */
export const lineNumbersExtension: EditorExtensionFactory = () => [lineNumbers(), highlightActiveLineGutter()];
