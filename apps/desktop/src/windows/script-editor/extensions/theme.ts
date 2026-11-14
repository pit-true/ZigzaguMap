import { EditorView } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/**
 * 飾りのない明るい見た目（色付けとテーマ 4 つは #191 で別のファイルに足す）。等幅の字と、本体の配色に合わせた行番号の帯。
 */
export const plainThemeExtension: EditorExtensionFactory = () =>
  EditorView.theme({
    "&": { height: "100%", backgroundColor: "#ffffff", color: "#000000", fontSize: "13px" },
    ".cm-scroller": { fontFamily: '"BIZ UDGothic", "MS Gothic", Consolas, monospace', lineHeight: "1.45" },
    ".cm-content": { caretColor: "#000000" },
    ".cm-gutters": { backgroundColor: "#f5f5f5", color: "#8a8a8a", borderRight: "1px solid #dddddd" },
    ".cm-activeLine": { backgroundColor: "#f3f8ff" },
    ".cm-activeLineGutter": { backgroundColor: "#e4eefb", color: "#333333" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "#cce1fa" },
  });
