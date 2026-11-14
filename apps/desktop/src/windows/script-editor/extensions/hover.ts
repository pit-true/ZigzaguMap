import type { EditorState } from "@codemirror/state";
import { EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import { asmHoverAt, type AsmHover } from "@zigzagumap/core";
import { jaScriptEditorAssist as t } from "../../../i18n/ja.scriptEditorAssist";
import { hoverHtml, hoverMarkdown } from "../hoverContent";
import { analyzeAt } from "./asmAt";
import type { EditorExtensionFactory, EditorFileContext } from "./context";
import { setPinnedTooltip } from "./pinned";
import { openStringEditor } from "./stringEdit";

/**
 * ホバー（拡張と同じ内容）。命令は CSV の hover かマクロの引数と直前のコメント、引数は文字列の本文（ND はひらがなと漢字の両方）・
 * `.equ` の値と説明・変数の説明・数と同じ値の名前・ラベルの定義の先頭の数行。文字列の参照には「本文を編集」のボタンを付ける（#196）。
 */

/** 位置のホバー（範囲は本文の位置）。出すものが無ければ null。 */
export interface HoverAt {
  readonly from: number;
  readonly to: number;
  readonly hover: AsmHover;
  readonly markdown: string;
}

/** 位置のホバーを求める（自動操作の `editor.hover` も使う）。 */
export function hoverAt(ctx: EditorFileContext, state: EditorState, pos: number): HoverAt | null {
  if (ctx.kind !== "asm") return null;
  const { line, column, analyzed } = analyzeAt(state, pos, ctx.project.assist);
  const h = asmHoverAt(ctx.project.assist, analyzed, column);
  if (!h) return null;
  return { from: line.from + h.start, to: line.from + h.end, hover: h, markdown: hoverMarkdown(h) };
}

/** ホバーの吹き出しの中身。 */
export function hoverDom(view: EditorView, ctx: EditorFileContext, info: HoverAt): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "se-hover";
  dom.dataset["autoId"] = "se.hover";
  dom.innerHTML = hoverHtml(info.markdown);
  if (info.hover.type === "string") {
    const bar = document.createElement("div");
    bar.className = "se-hover-actions";
    for (const ref of info.hover.refs) {
      if (ref.label === null || ref.entries.length === 0) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${t.hover.edit}（${ref.label}）`;
      button.dataset["autoId"] = `se.hover.edit:${ref.label}`;
      const label = ref.label;
      button.addEventListener("click", () => openStringEditor(view, ctx, label, info.from));
      bar.append(button);
    }
    if (bar.childElementCount > 0) dom.append(bar);
  }
  return dom;
}

/** 位置のホバーを、消えない吹き出しとして出す（自動操作のスクリーンショット用）。出せなければ null。 */
export function showPinnedHover(view: EditorView, ctx: EditorFileContext, pos: number): HoverAt | null {
  const info = hoverAt(ctx, view.state, pos);
  if (!info) return null;
  const tooltip: Tooltip = { pos: info.from, end: info.to, above: false, create: (v) => ({ dom: withClass(hoverDom(v, ctx, info), "se-pinned") }) };
  view.dispatch({ effects: setPinnedTooltip.of(tooltip) });
  return info;
}

function withClass(dom: HTMLElement, cls: string): HTMLElement {
  dom.classList.add(cls);
  return dom;
}

export const hoverExtension: EditorExtensionFactory = (ctx) => {
  if (ctx.kind !== "asm") return [];
  return [
    hoverTooltip(
      (view, pos) => {
        const info = hoverAt(ctx, view.state, pos);
        if (!info) return null;
        return { pos: info.from, end: info.to, above: true, create: (v) => ({ dom: hoverDom(v, ctx, info) }) };
      },
      { hoverTime: 350 },
    ),
    EditorView.baseTheme({
      ".se-hover": { padding: "4px 8px" },
      ".se-hover p": { margin: "4px 0" },
      ".se-hover pre": { margin: "4px 0", padding: "4px 6px", whiteSpace: "pre-wrap" },
      ".se-hover-actions": { display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" },
    }),
  ];
};
