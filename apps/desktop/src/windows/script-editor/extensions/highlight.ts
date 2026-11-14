import { RangeSetBuilder, StateEffect, type Text } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { asmSemanticTokens, localMacroNames, parseAsmLine, type AsmSemanticKind } from "@zigzagumap/core";
import type { EditorExtensionFactory } from "./context";

/**
 * 命令名と引数の種類の色（拡張の semantic token と同じ役目）。命令表と索引で種類を決め、見えている行にだけ印（class）を付ける。
 * 色はテーマ（themes.ts）が `.cm-sem-*` に付ける。打鍵のたびに描き直すのは見えている行だけなので、数千行の `.s` でも重くならない。
 */

/** プロジェクトの知識（命令表・索引）が変わったときに送る印（描き直す）。 */
export const projectChangedEffect = StateEffect.define<null>();

/** 種類ごとの印。class は自動操作の `editor.tokens` でも返す。 */
export const SEMANTIC_CLASS: Record<AsmSemanticKind, string> = {
  command: "cm-sem-command",
  instruction: "cm-sem-instruction",
  unknownCommand: "cm-sem-unknown",
  textRef: "cm-sem-text",
  labelRef: "cm-sem-label",
  variable: "cm-sem-variable",
  constant: "cm-sem-constant",
};
const MARKS = Object.fromEntries(Object.entries(SEMANTIC_CLASS).map(([k, cls]) => [k, Decoration.mark({ class: cls })])) as Record<AsmSemanticKind, Decoration>;

/**
 * 行が `/* *\/` の中で始まるか（前の行までの状態）を、行の番号ごとに覚える。
 * `/*` と `*\/` を含まない行は前の行の状態を引き継ぐだけなので、解析するのは記号のある行だけ。
 */
export class BlockCommentTracker {
  /** ends[i] は i + 1 行目が `/* *\/` の中で終わるか。 */
  private ends: boolean[] = [];

  /** 行（1 から）の前の行が `/* *\/` の中で終わったか。 */
  before(doc: Text, line: number): boolean {
    for (let n = this.ends.length + 1; n < line; n++) {
      const start = n > 1 ? this.ends[n - 2]! : false;
      const text = doc.line(n).text;
      this.ends.push(text.includes("/*") || text.includes("*/") ? parseAsmLine(text, start).endsInBlockComment : start);
    }
    return line > 1 ? this.ends[line - 2]! : false;
  }

  /** 行（1 から）から後ろを忘れる（本文が変わったとき）。 */
  invalidate(line: number): void {
    if (this.ends.length >= line) this.ends.length = Math.max(0, line - 1);
  }
}

/** 本文の `.macro` の名前（小文字）。 */
function macrosOf(doc: Text): Set<string> {
  const lines = [];
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    if (text.includes(".macro")) lines.push(parseAsmLine(text));
  }
  return localMacroNames(lines);
}

export const semanticHighlightExtension: EditorExtensionFactory = (ctx) => {
  if (ctx.kind !== "asm") return [];
  const assist = ctx.project.assist;
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly tracker = new BlockCommentTracker();
      private macros: Set<string>;

      constructor(view: EditorView) {
        this.macros = macrosOf(view.state.doc);
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate): void {
        let rebuild = u.viewportChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(projectChangedEffect)));
        if (u.docChanged) {
          let first = Infinity;
          let macroTouched = false;
          u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            first = Math.min(first, u.startState.doc.lineAt(fromA).number);
            if (/\.(macro|endm)/.test(u.startState.sliceDoc(fromA, toA) + inserted.toString())) macroTouched = true;
          });
          this.tracker.invalidate(first);
          if (macroTouched) this.macros = macrosOf(u.state.doc);
          rebuild = true;
        }
        if (rebuild) this.decorations = this.build(u.view);
      }

      private build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        for (const { from, to } of view.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = doc.lineAt(pos);
            const parsed = parseAsmLine(line.text, this.tracker.before(doc, line.number));
            const analyzed = assist.analyzeParsed(parsed, this.macros);
            for (const t of asmSemanticTokens(analyzed)) builder.add(line.from + t.start, line.from + t.end, MARKS[t.kind]);
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
};
