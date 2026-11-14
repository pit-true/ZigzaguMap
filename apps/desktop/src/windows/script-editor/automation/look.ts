import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { asmSemanticTokens, parseAsmLine } from "@zigzagumap/core";
import { settle } from "../../../app/automation/registry";
import { BlockCommentTracker, SEMANTIC_CLASS } from "../extensions/highlight";
import { EDITOR_THEMES, PALETTES, currentEditorTheme, isEditorTheme } from "../extensions/themes";
import type { ScriptEditorWindow } from "../ScriptEditorWindow";
import { ctxOf, requireActive, type EditorCommandTable } from "./common";

/** 字句の種類の名前（`editor.tokens` で返す）。 */
const SYNTAX = tagHighlighter([
  { tag: [tags.lineComment, tags.blockComment, tags.comment], class: "comment" },
  { tag: tags.labelName, class: "labelDef" },
  { tag: tags.keyword, class: "directive" },
  { tag: tags.number, class: "number" },
  { tag: tags.string, class: "string" },
  { tag: tags.macroName, class: "macroArg" },
  { tag: tags.escape, class: "escape" },
  { tag: tags.special(tags.variableName), class: "placeholder" },
  { tag: tags.atom, class: "special" },
  { tag: tags.processingInstruction, class: "rawBytes" },
  { tag: tags.meta, class: "meta" },
]);

/** 行ごとの字句の種類と、命令表で決めた種類。 */
function tokensOf(w: ScriptEditorWindow, from: number, to: number): unknown[] {
  const state = w.view.state;
  const doc = state.doc;
  const end = doc.line(to).to;
  const tree = ensureSyntaxTree(state, end, 2000) ?? syntaxTree(state);
  const tracker = new BlockCommentTracker();
  const ctx = ctxOf(w);
  const out: unknown[] = [];
  for (let n = from; n <= to; n++) {
    const line = doc.line(n);
    const syntax: { text: string; column: number; kind: string }[] = [];
    highlightTree(tree, SYNTAX, (a, b, cls) => syntax.push({ text: doc.sliceString(a, b), column: a - line.from + 1, kind: cls }), line.from, line.to);
    const semantic =
      ctx.kind === "asm"
        ? asmSemanticTokens(ctx.project.assist.analyzeParsed(parseAsmLine(line.text, tracker.before(doc, n)))).map((t) => ({
            text: line.text.slice(t.start, t.end),
            column: t.start + 1,
            kind: t.kind,
            class: SEMANTIC_CLASS[t.kind],
          }))
        : [];
    out.push({ line: n, text: line.text, syntax, semantic });
  }
  return out;
}

/** 表示中の印の、実際の色（テーマが種類ごとに違う色を付けているか）。 */
function renderedColors(w: ScriptEditorWindow): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const pick = (selector: string) => {
    const el = w.view.contentDOM.querySelector(selector);
    return el ? getComputedStyle(el).color : null;
  };
  for (const [kind, cls] of Object.entries(SEMANTIC_CLASS)) out[kind] = pick(`.${cls}`);
  // コメントとラベル定義の色（字句の色。見えている行から探す）
  const state = w.view.state;
  const colorAt = (p: number): string | null => {
    const { node } = w.view.domAtPos(p + 1);
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    return el ? getComputedStyle(el).color : null;
  };
  out["comment"] = null;
  out["labelDef"] = null;
  for (const { from, to } of w.view.visibleRanges) {
    for (let p = from; p <= to && (out["comment"] === null || out["labelDef"] === null); ) {
      const line = state.doc.lineAt(p);
      const at = line.text.indexOf("@");
      if (out["comment"] === null && at >= 0 && !line.text.slice(0, at).includes('"')) out["comment"] = colorAt(line.from + at);
      if (out["labelDef"] === null && /^[A-Za-z_]\w*:/.test(line.text)) out["labelDef"] = colorAt(line.from);
      p = line.to + 1;
    }
  }
  out["background"] = getComputedStyle(w.view.dom).backgroundColor;
  return out;
}

/** 色付けとテーマ（`editor.tokens` / `editor.theme`）。 */
export const lookCommands: EditorCommandTable = {
  "editor.tokens": (w, req) => {
    requireActive(w);
    const doc = w.view.state.doc;
    const from = Math.max(1, typeof req["line"] === "number" ? req["line"] : typeof req["fromLine"] === "number" ? req["fromLine"] : 1);
    const to = Math.min(doc.lines, typeof req["toLine"] === "number" ? req["toLine"] : typeof req["line"] === "number" ? from : doc.lines);
    return { path: w.active!.path, lines: tokensOf(w, from, to) };
  },

  "editor.theme": async (w, req) => {
    if (req["theme"] !== undefined) {
      if (!isEditorTheme(req["theme"])) throw new Error(`テーマは ${EDITOR_THEMES.join(" / ")} のどれかです`);
      w.setTheme(req["theme"]);
      await settle(150);
    }
    const id = currentEditorTheme();
    return { theme: id, themes: EDITOR_THEMES, palette: PALETTES[id], rendered: w.active ? renderedColors(w) : null };
  },
};
