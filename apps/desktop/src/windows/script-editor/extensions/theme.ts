import { EditorView } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/**
 * テーマに依らない見た目（等幅の字、行の高さ、ホバーと補完の窓の大きさ）。色はテーマ 4 つ（themes.ts）が付ける。
 */
export const plainThemeExtension: EditorExtensionFactory = () =>
  EditorView.baseTheme({
    "&": { height: "100%", fontSize: "13px" },
    ".cm-scroller": { fontFamily: '"BIZ UDGothic", "MS Gothic", Consolas, monospace', lineHeight: "1.45" },
    ".cm-tooltip.cm-tooltip-hover, .cm-tooltip.se-pinned": { maxWidth: "560px", maxHeight: "360px", overflow: "auto" },
    ".cm-tooltip-autocomplete > ul": { fontFamily: '"BIZ UDGothic", "MS Gothic", Consolas, monospace', maxHeight: "16em" },
    ".cm-completionInfo": { maxWidth: "420px", whiteSpace: "pre-wrap" },
  });
