import { forEachDiagnostic, forceLinting, lintGutter, linter, nextDiagnostic, openLintPanel, type Diagnostic } from "@codemirror/lint";
import type { EditorState, Text } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { lintAsmText, lintStringText, type ScriptDiagnostic } from "@zigzagumap/core";
import { jaScriptEditorAssist as t } from "../../../i18n/ja.scriptEditorAssist";
import type { EditorExtensionFactory } from "./context";
import { projectChangedEffect } from "./highlight";
import { widthOptions } from "./stringEdit";

/**
 * 波線（#195。拡張には `.s` の診断は無い）。`.s` は知らない命令・引数の数の過不足（マクロの `:req`）・どこにも定義の無いラベル、
 * `.string` は重複したラベル（同じファイルはエラー、別のファイルは警告）と、文字数による簡易の幅検査（#196）。
 * 打つのを止めて 0.5 秒で調べ直す。行番号の横に印、F8 で次の波線へ、Ctrl+Shift+M で一覧。
 *
 * 外から足す波線（ビルドのエラー、保存時の check_text_width.py の結果）は `setExternalDiagnostics` で、ファイルの行ごとに入れる。
 * 本文を変えても行のまま残り、次にその出どころが結果を入れ直したときに入れ替わる。
 */

/** 外から足す波線 1 つ。行と桁は 1 から（桁を省くと行の全体）。 */
export interface ExternalDiagnostic {
  readonly line: number;
  readonly column?: number;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
}

/** パス → 出どころ（`widthCheck` など）→ 波線。 */
const external = new Map<string, Map<string, readonly ExternalDiagnostic[]>>();

/** 外から足す波線を入れ替える（空の配列で消す）。 */
export function setExternalDiagnostics(path: string, source: string, list: readonly ExternalDiagnostic[]): void {
  let bySource = external.get(path);
  if (!bySource) external.set(path, (bySource = new Map()));
  if (list.length === 0) bySource.delete(source);
  else bySource.set(source, list);
}

/** 出どころの波線を、全部のファイルから消す。 */
export function clearExternalDiagnostics(source: string): string[] {
  const paths: string[] = [];
  for (const [path, bySource] of external) if (bySource.delete(source)) paths.push(path);
  return paths;
}

/** ファイルの外から足した波線（出どころごと）。 */
export function externalDiagnosticsOf(path: string): { source: string; list: readonly ExternalDiagnostic[] }[] {
  return [...(external.get(path) ?? new Map<string, readonly ExternalDiagnostic[]>())].map(([source, list]) => ({ source, list }));
}

/**
 * すぐに調べ直す（外から足した波線を変えたあとなど）。CodeMirror の forceLinting は、本文が変わって調べ直しを待っているときしか
 * 動かないので、先に「知識が変わった」印を送って待ちの状態にしてから強制する。
 */
export function relint(view: EditorView): void {
  view.dispatch({ effects: projectChangedEffect.of(null) });
  forceLinting(view);
}

/** 波線の文言。 */
export function diagnosticMessage(d: ScriptDiagnostic): string {
  const p = d.params;
  const s = (k: string) => String(p[k] ?? "");
  const n = (k: string) => Number(p[k] ?? 0);
  switch (d.code) {
    case "unknownCommand":
      return t.lint.unknownCommand(s("name"));
    case "undefinedLabel":
      return t.lint.undefinedLabel(s("name"), s("role"));
    case "missingArgs":
      return t.lint.missingArgs(s("name"), s("missing"));
    case "tooManyArgs":
      return t.lint.tooManyArgs(s("name"), n("max"), n("given"));
    case "unassemblableMacro":
      return t.lint.unassemblableMacro(s("name"), s("missing"), s("via"));
    case "duplicateString":
      return t.lint.duplicateString(s("label"), n("line"));
    case "duplicateStringOther":
      return t.lint.duplicateStringOther(s("label"), s("path"), n("line"));
    case "textWidth":
      return s("kind") === "lines" ? t.lint.textWidthLines(s("label"), n("page"), n("limit")) : t.lint.textWidthColumns(s("label"), n("page"), n("line"), n("columns"), n("limit"));
    case "strayStringLine":
      return t.lint.strayStringLine(s("label"));
    case "spaceAfterBreak":
      return t.lint.spaceAfterBreak(s("label"));
    case "external":
      return s("message");
  }
}

function externalToDiagnostics(doc: Text, path: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const { source, list } of externalDiagnosticsOf(path)) {
    for (const e of list) {
      if (e.line < 1 || e.line > doc.lines) continue;
      const line = doc.line(e.line);
      const from = e.column ? Math.min(line.to, line.from + e.column - 1) : line.from;
      out.push({ from, to: Math.max(from, line.to), severity: e.severity, message: e.message, source });
    }
  }
  return out;
}

/** 本文の波線（外から足したものを含む）を作る。 */
function diagnosticsFor(state: EditorState, ctx: Parameters<EditorExtensionFactory>[0]): Diagnostic[] {
  const project = ctx.project;
  const doc = state.doc;
  const out: Diagnostic[] = [];
  if (project.loaded) {
    project.flushBuffers();
    const text = doc.toString();
    const found =
      ctx.kind === "asm"
        ? project.assist.commands
          ? lintAsmText(project.assist, text)
          : []
        : lintStringText(text, { path: ctx.path, strings: project.assist.strings, width: widthOptions(ctx) });
    for (const d of found) {
      const from = Math.min(d.from, doc.length);
      // ピクセルで数える幅検査のコマンドがあるプロジェクト（Chronos）では、字数の検査は目安なので「情報」の印にする
      const severity = d.code === "textWidth" && project.config?.widthCheck ? "info" : d.severity;
      out.push({ from, to: Math.min(Math.max(d.to, from), doc.length), severity, message: diagnosticMessage(d), source: d.code });
    }
  }
  out.push(...externalToDiagnostics(doc, ctx.path));
  return out;
}

/** 今出ている波線（自動操作の `editor.state` と `editor.diagnostics` で返す）。 */
export function currentDiagnostics(state: EditorState): { from: number; to: number; line: number; column: number; severity: string; source: string; message: string; text: string }[] {
  const out: ReturnType<typeof currentDiagnostics> = [];
  forEachDiagnostic(state, (d, from, to) => {
    const line = state.doc.lineAt(from);
    out.push({ from, to, line: line.number, column: from - line.from + 1, severity: d.severity, source: d.source ?? "", message: d.message, text: state.sliceDoc(from, to) });
  });
  return out;
}

export const lintExtension: EditorExtensionFactory = (ctx) => [
  linter((view) => diagnosticsFor(view.state, ctx), {
    delay: 500,
    needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(projectChangedEffect))),
  }),
  lintGutter(),
  keymap.of([
    { key: "F8", run: nextDiagnostic },
    { key: "Mod-Shift-m", run: openLintPanel },
  ]),
];
