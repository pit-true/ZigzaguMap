import { crosshairCursor, rectangularSelection } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/**
 * 矩形選択と複数カーソル（#194）。Alt＋ドラッグで矩形選択（Alt を押している間は十字のカーソル）。
 * Ctrl+クリックでカーソルを足す（定義のある名前の上では定義へ移動。definition.ts）。Ctrl+Alt+↑↓ で上下にカーソルを足す。
 * 行の移動（Alt+↑↓）・複製（Shift+Alt+↑↓）・コメントの切り替え（Ctrl+/）は標準のキー（keymap.ts の defaultKeymap）で、
 * コメントの記号は言語（language.ts）が決める（`.s` は `@`、`.string` は `//`）。
 */
export const editingExtension: EditorExtensionFactory = () => [rectangularSelection(), crosshairCursor()];
