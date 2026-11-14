import { Prec, type EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { asmDefinitionAt, type AsmDefinition } from "@zigzagumap/core";
import { jaScriptEditorAssist as t } from "../../../i18n/ja.scriptEditorAssist";
import { isEditableScriptPath } from "../fileText";
import { analyzeAt } from "./asmAt";
import type { EditorExtensionFactory, EditorFileContext } from "./context";

/**
 * 定義へ移動（#193。拡張には無い機能）。F12 か Ctrl+クリックで、ラベル（assembly の `.s`）・文字列のラベル（`.string` の `#org` の行）・
 * `.equ` の定義へ移る。別のファイルならタブを開く。戻るのは Alt+←（マウスの「戻る」ボタンでも）。
 * 見つからないときと、エディタで開けないファイル（xse_commands.s など）の定義は、下の帯に場所を出す。
 * Ctrl+クリックは、定義のある名前の上なら移動、それ以外ではカーソルを足す（複数カーソル、#194）。
 */

/** 位置の名前の定義（範囲は本文の位置）。名前でなければ null。 */
export function definitionAt(ctx: EditorFileContext, state: EditorState, pos: number): (AsmDefinition & { readonly from: number; readonly to: number }) | null {
  if (ctx.kind !== "asm") return null;
  const { line, column, analyzed } = analyzeAt(state, pos, ctx.project.assist);
  const d = asmDefinitionAt(ctx.project.assist, analyzed, column, ctx.path);
  return d ? { ...d, from: line.from + d.start, to: line.from + d.end } : null;
}

/**
 * 位置の名前の定義へ移る。移ったら true（見つからなければ下の帯に出して false）。
 * 先にカーソルをその名前へ置くので、「戻る」はクリック（F12 を押した）位置へ戻る。
 */
export async function goToDefinition(ctx: EditorFileContext, view: EditorView, pos: number): Promise<boolean> {
  const state = view.state;
  const d = definitionAt(ctx, state, pos);
  if (d && d.targets[0] && isEditableScriptPath(d.targets[0].path) && state.selection.main.head !== pos) {
    view.dispatch({ selection: { anchor: pos } });
  }
  if (!d) {
    ctx.host.setMessage(t.definition.noWord);
    return false;
  }
  const target = d.targets[0];
  if (!target) {
    ctx.host.setMessage(t.definition.notFound(d.name));
    return false;
  }
  if (!isEditableScriptPath(target.path)) {
    ctx.host.setMessage(t.definition.outside(d.name, target.path, target.line));
    return false;
  }
  const ok = await ctx.host.navigate(target.path, target.line);
  if (ok) ctx.host.setMessage(t.definition.moved(d.name, target.path, target.line) + (d.targets.length > 1 ? t.definition.many(d.targets.length - 1) : ""));
  return ok;
}

export const definitionExtension: EditorExtensionFactory = (ctx) => {
  const back = () => {
    void ctx.host.back().then((ok) => {
      if (!ok) ctx.host.setMessage(t.definition.noBack);
    });
    return true;
  };
  return [
    Prec.high(
      keymap.of([
        {
          key: "F12",
          preventDefault: true,
          run: (view) => {
            void goToDefinition(ctx, view, view.state.selection.main.head);
            return true;
          },
        },
        { key: "Alt-ArrowLeft", preventDefault: true, run: back },
      ]),
    ),
    EditorView.domEventHandlers({
      mousedown: (e, view) => {
        if (e.button === 3) {
          e.preventDefault();
          return back();
        }
        if (e.button !== 0 || !e.ctrlKey || e.altKey || e.shiftKey || ctx.kind !== "asm") return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        const d = definitionAt(ctx, view.state, pos);
        if (!d || d.targets.length === 0) return false;
        e.preventDefault();
        void goToDefinition(ctx, view, pos);
        return true;
      },
    }),
  ];
};
