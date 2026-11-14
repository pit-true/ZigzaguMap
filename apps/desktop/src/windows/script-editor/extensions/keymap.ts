import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import type { EditorExtensionFactory } from "./context";

/**
 * キー操作: Ctrl+S でこのファイルを保存（メインの「出力」は動かさない）、Tab で字下げ、標準のキー（カーソル移動・行の削除など）と
 * 履歴（Ctrl+Z / Ctrl+Y）。ほかの機能のキーは、その機能の拡張のファイルで足す。
 */
export const keymapExtension: EditorExtensionFactory = (ctx) =>
  keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        ctx.save();
        return true;
      },
    },
    indentWithTab,
    ...defaultKeymap,
    ...historyKeymap,
  ]);
