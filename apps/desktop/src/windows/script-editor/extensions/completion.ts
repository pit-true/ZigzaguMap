import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { asmCompletionAt, type AsmCompletion, type AsmCompletionType } from "@zigzagumap/core";
import { hoverHtml } from "../hoverContent";
import { analyzeAt } from "./asmAt";
import type { EditorExtensionFactory, EditorFileContext } from "./context";

/**
 * 補完（Ctrl+Space、または名前を打ったとき・引数の区切りの空白を打ったとき）。
 * 命令名の位置では命令表の命令とディレクティブ、引数の位置では引数の種類に合わせて、文字列のラベル・ラベル・移動の名前・
 * 変数・フラグ・定数を出す。msgbox の種類の引数は `MSG_*`。拡張にあった補完（命令名と MSG_*）に、ラベルなどを足したもの。
 */

/** 候補の種類 → CodeMirror の印（左の小さな絵）。 */
const TYPE: Record<AsmCompletionType, string> = {
  command: "function",
  directive: "keyword",
  label: "class",
  string: "text",
  movement: "enum",
  variable: "variable",
  flag: "constant",
  constant: "constant",
  msgType: "enum",
};

/** 位置の補完（範囲は本文の位置）。自動操作の `editor.complete` も使う。 */
export function completionAt(ctx: EditorFileContext, state: EditorState, pos: number): (AsmCompletion & { readonly lineFrom: number }) | null {
  if (ctx.kind !== "asm") return null;
  const { line, column, analyzed } = analyzeAt(state, pos, ctx.project.assist);
  const c = asmCompletionAt(ctx.project.assist, analyzed, column);
  return c ? { ...c, lineFrom: line.from } : null;
}

function toOption(item: AsmCompletion["items"][number]): Completion {
  const option: Completion = { label: item.label, type: TYPE[item.type] };
  if (item.detail) option.detail = item.detail;
  if (item.boost) option.boost = item.boost;
  if (item.info) {
    const info = item.info;
    option.info = () => {
      const dom = document.createElement("div");
      dom.className = "se-hover";
      dom.innerHTML = hoverHtml(info);
      return dom;
    };
  }
  return option;
}

export const completionExtension: EditorExtensionFactory = (ctx) => {
  if (ctx.kind !== "asm") return [];
  const source = (context: CompletionContext): CompletionResult | null => {
    const c = completionAt(ctx, context.state, context.pos);
    if (!c) return null;
    const from = c.lineFrom + c.from;
    if (!context.explicit && from === context.pos) {
      // 何も打っていないときは、引数の区切り（空白・カンマ）の直後だけ出す
      const before = context.state.sliceDoc(context.pos - 1, context.pos);
      if (c.context !== "argument" || !/[\s,]/.test(before)) return null;
    }
    return { from, to: c.lineFrom + c.to, options: c.items.map(toOption), validFor: /^[\w.$]*$/ };
  };
  return autocompletion({ override: [source], maxRenderedOptions: 200, closeOnBlur: true });
};
