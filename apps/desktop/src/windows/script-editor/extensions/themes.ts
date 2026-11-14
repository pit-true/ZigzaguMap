import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { EditorExtensionFactory } from "./context";

/**
 * テーマ 4 つ（Dark+ 風・Light+ 風・Monokai 風・Solarized Dark 風）。テーマのパッケージは入れず、`EditorView.theme` と
 * `HighlightStyle` を自前で書く。色を分けるのは、字句の種類（コメント・ラベル定義・ディレクティブ・数・文字列・`.string` の制御）と、
 * 命令表と索引で決めた種類（highlight.ts の `.cm-sem-*`: 命令・ARM の命令・文字列の参照・ラベルの参照・変数・定数）。
 * 選んだテーマは個人設定（settings.json の `scriptEditorTheme`）に残す。
 */

export type EditorThemeId = "darkPlus" | "lightPlus" | "monokai" | "solarizedDark";
export const EDITOR_THEMES: readonly EditorThemeId[] = ["darkPlus", "lightPlus", "monokai", "solarizedDark"];
export const DEFAULT_EDITOR_THEME: EditorThemeId = "lightPlus";

/** テーマの色。 */
interface Palette {
  dark: boolean;
  bg: string;
  fg: string;
  gutterBg: string;
  gutterFg: string;
  activeLine: string;
  activeGutter: string;
  selection: string;
  cursor: string;
  match: string;
  panel: string;
  border: string;
  comment: string;
  labelDef: string;
  directive: string;
  number: string;
  string: string;
  macroArg: string;
  escape: string;
  placeholder: string;
  special: string;
  raw: string;
  command: string;
  instruction: string;
  text: string;
  label: string;
  variable: string;
  constant: string;
}

export const PALETTES: Record<EditorThemeId, Palette> = {
  darkPlus: {
    dark: true, bg: "#1e1e1e", fg: "#d4d4d4", gutterBg: "#1e1e1e", gutterFg: "#858585", activeLine: "#2a2d2e", activeGutter: "#2a2d2e",
    selection: "#264f78", cursor: "#aeafad", match: "#613214", panel: "#252526", border: "#454545",
    comment: "#6a9955", labelDef: "#dcdcaa", directive: "#c586c0", number: "#b5cea8", string: "#ce9178", macroArg: "#9cdcfe",
    escape: "#d7ba7d", placeholder: "#4fc1ff", special: "#4ec9b0", raw: "#808080",
    command: "#569cd6", instruction: "#c586c0", text: "#ce9178", label: "#dcdcaa", variable: "#9cdcfe", constant: "#b5cea8",
  },
  lightPlus: {
    dark: false, bg: "#ffffff", fg: "#000000", gutterBg: "#f5f5f5", gutterFg: "#237893", activeLine: "#f3f8ff", activeGutter: "#e4eefb",
    selection: "#add6ff", cursor: "#000000", match: "#f8c9ab", panel: "#f3f3f3", border: "#cccccc",
    comment: "#008000", labelDef: "#795e26", directive: "#af00db", number: "#098658", string: "#a31515", macroArg: "#001080",
    escape: "#ee0000", placeholder: "#0070c1", special: "#267f99", raw: "#808080",
    command: "#0000ff", instruction: "#af00db", text: "#a31515", label: "#795e26", variable: "#001080", constant: "#098658",
  },
  monokai: {
    dark: true, bg: "#272822", fg: "#f8f8f2", gutterBg: "#272822", gutterFg: "#90908a", activeLine: "#3e3d32", activeGutter: "#3e3d32",
    selection: "#49483e", cursor: "#f8f8f0", match: "#6b5b14", panel: "#1e1f1c", border: "#414339",
    comment: "#75715e", labelDef: "#a6e22e", directive: "#f92672", number: "#ae81ff", string: "#e6db74", macroArg: "#fd971f",
    escape: "#ae81ff", placeholder: "#66d9ef", special: "#a6e22e", raw: "#75715e",
    command: "#66d9ef", instruction: "#f92672", text: "#e6db74", label: "#a6e22e", variable: "#fd971f", constant: "#ae81ff",
  },
  solarizedDark: {
    dark: true, bg: "#002b36", fg: "#839496", gutterBg: "#073642", gutterFg: "#586e75", activeLine: "#073642", activeGutter: "#0b4452",
    selection: "#274642", cursor: "#d30102", match: "#5d4a00", panel: "#00212b", border: "#0b4452",
    comment: "#586e75", labelDef: "#b58900", directive: "#859900", number: "#d33682", string: "#2aa198", macroArg: "#cb4b16",
    escape: "#dc322f", placeholder: "#268bd2", special: "#6c71c4", raw: "#657b83",
    command: "#268bd2", instruction: "#859900", text: "#2aa198", label: "#b58900", variable: "#cb4b16", constant: "#d33682",
  },
};

function build(p: Palette): Extension {
  const view = EditorView.theme(
    {
      "&": { backgroundColor: p.bg, color: p.fg },
      ".cm-content": { caretColor: p.cursor },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: p.cursor },
      ".cm-gutters": { backgroundColor: p.gutterBg, color: p.gutterFg, borderRight: `1px solid ${p.border}` },
      ".cm-activeLine": { backgroundColor: p.activeLine },
      ".cm-activeLineGutter": { backgroundColor: p.activeGutter, color: p.fg },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: p.selection },
      ".cm-selectionMatch": { backgroundColor: p.match },
      ".cm-searchMatch": { backgroundColor: p.match, outline: `1px solid ${p.border}` },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: p.selection },
      ".cm-panels": { backgroundColor: p.panel, color: p.fg, borderColor: p.border },
      ".cm-panels input, .cm-panels button": { color: p.fg, backgroundColor: p.bg, border: `1px solid ${p.border}` },
      ".cm-tooltip": { backgroundColor: p.panel, color: p.fg, border: `1px solid ${p.border}` },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: p.selection, color: p.fg },
      ".cm-completionDetail": { color: p.comment },
      ".cm-sem-command, .cm-sem-command span": { color: p.command },
      ".cm-sem-instruction, .cm-sem-instruction span": { color: p.instruction },
      ".cm-sem-text, .cm-sem-text span": { color: p.text, fontStyle: "italic" },
      ".cm-sem-label, .cm-sem-label span": { color: p.label },
      ".cm-sem-variable, .cm-sem-variable span": { color: p.variable },
      ".cm-sem-constant, .cm-sem-constant span": { color: p.constant },
      ".se-hover code, .se-hover pre": { backgroundColor: p.bg, color: p.fg },
    },
    { dark: p.dark },
  );
  const style = HighlightStyle.define([
    { tag: [tags.lineComment, tags.blockComment, tags.comment], color: p.comment },
    { tag: tags.labelName, color: p.labelDef, fontWeight: "bold" },
    { tag: tags.keyword, color: p.directive },
    { tag: tags.number, color: p.number },
    { tag: tags.string, color: p.string },
    { tag: tags.macroName, color: p.macroArg },
    { tag: tags.escape, color: p.escape, fontWeight: "bold" },
    { tag: tags.special(tags.variableName), color: p.placeholder },
    { tag: tags.atom, color: p.special },
    { tag: tags.processingInstruction, color: p.raw },
    { tag: tags.meta, color: p.directive },
    { tag: tags.punctuation, color: p.fg },
  ]);
  return [view, syntaxHighlighting(style)];
}

const built = new Map<EditorThemeId, Extension>();

/** テーマの拡張（同じテーマは同じものを返す）。 */
export function themeFor(id: EditorThemeId): Extension {
  let ext = built.get(id);
  if (!ext) built.set(id, (ext = build(PALETTES[id])));
  return ext;
}

/** 名前がテーマか。 */
export function isEditorTheme(id: unknown): id is EditorThemeId {
  return typeof id === "string" && (EDITOR_THEMES as readonly string[]).includes(id);
}

/** テーマを入れ替える区画（タブの EditorState ごと）。 */
export const themeCompartment = new Compartment();

/** 今のテーマ（ウィンドウで 1 つ。ScriptEditorWindow が個人設定から決め、変えたら全部のタブを入れ替える）。 */
let current: EditorThemeId = DEFAULT_EDITOR_THEME;

export function currentEditorTheme(): EditorThemeId {
  return current;
}

export function setCurrentEditorTheme(id: EditorThemeId): void {
  current = id;
  document.documentElement.dataset["seTheme"] = id;
}

export const themesExtension: EditorExtensionFactory = () => themeCompartment.of(themeFor(current));
