import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tags } from "@lezer/highlight";
import type { EditorExtensionFactory } from "./context";
import { DEFAULT_EDITOR_THEME, EDITOR_THEMES, PALETTES, uiVariables, type CodePalette, type EditorPalette, type EditorThemeId } from "./palettes";

/**
 * テーマ 4 つ（Dark+ 風・Light+ 風・Monokai 風・Solarized Dark 風）。テーマのパッケージは入れず、`EditorView.theme` と
 * `HighlightStyle` を自前で書く。色を分けるのは、字句の種類（コメント・ラベル定義・ディレクティブ・数・文字列・`.string` の制御）と、
 * 命令表と索引で決めた種類（highlight.ts の `.cm-sem-*`: 命令・ARM の命令・文字列の参照・ラベルの参照・変数・定数）。
 * 選んだテーマは個人設定（settings.json の `scriptEditorTheme`）に残す。色の表は palettes.ts。
 * テーマはウィンドウ全体に当てる（#218）。本文はタブごとの区画、部品（帯・ダイアログ・入力欄・スクロールバー）は CSS 変数。
 */

export { DEFAULT_EDITOR_THEME, EDITOR_THEMES, PALETTES, type EditorThemeId } from "./palettes";

function build(palette: EditorPalette): Extension {
  const p: CodePalette = palette.code;
  const u = palette.ui;
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
      ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${p.border}` },
      ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${p.border}` },
      ".cm-panels input, .cm-panels .cm-textfield": { color: u.fieldText, backgroundColor: u.field, border: `1px solid ${u.fieldBorder}` },
      ".cm-panels button, .cm-panels .cm-button": {
        color: u.buttonText, backgroundColor: u.button, backgroundImage: "none", border: `1px solid ${u.buttonBorder}`,
      },
      ".cm-panels .cm-button:hover, .cm-panels button:hover": { backgroundColor: u.buttonHot },
      ".cm-panels .cm-button:active": { backgroundColor: u.hot, backgroundImage: "none" },
      ".cm-panel button[name=close]": { color: u.muted, backgroundColor: "transparent", border: "none" },
      ".cm-panel label": { color: p.fg },
      ".cm-panel.cm-panel-lint ul": { backgroundColor: p.bg, color: p.fg },
      ".cm-panel.cm-panel-lint ul [aria-selected]": { backgroundColor: p.selection, color: p.fg },
      ".cm-panel.cm-panel-lint ul:focus [aria-selected]": { backgroundColor: u.select, color: u.selectText },
      ".cm-tooltip": { backgroundColor: p.panel, color: p.fg, border: `1px solid ${p.border}` },
      ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: p.border, borderBottomColor: p.border },
      ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: p.panel, borderBottomColor: p.panel },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: u.select, color: u.selectText },
      ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": { color: u.selectText },
      ".cm-completionDetail": { color: p.comment },
      ".cm-completionMatchedText": { color: u.accent, textDecoration: "none", fontWeight: "bold" },
      ".cm-tooltip button, .cm-tooltip textarea, .cm-tooltip input": {
        color: u.fieldText, backgroundColor: u.field, border: `1px solid ${u.fieldBorder}`,
      },
      ".cm-tooltip button": { color: u.buttonText, backgroundColor: u.button, borderColor: u.buttonBorder },
      ".cm-tooltip button:hover": { backgroundColor: u.buttonHot },
      ".cm-tooltip a": { color: u.link },
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

/** 題名の帯を暗くしたか（明るいテーマでは Windows の設定に任せる）。 */
let titleDark = false;

export function currentEditorTheme(): EditorThemeId {
  return current;
}

/**
 * テーマを今のものにし、ウィンドウの部品の色（CSS 変数）・標準の部品の明暗（color-scheme）・題名の帯を合わせる。
 * 本文の色は呼ぶ側がタブの区画（themeCompartment）を入れ替える。
 */
export function setCurrentEditorTheme(id: EditorThemeId): void {
  current = id;
  const root = document.documentElement;
  root.dataset["seTheme"] = id;
  const palette = PALETTES[id];
  for (const [name, value] of Object.entries(uiVariables(palette))) root.style.setProperty(name, value);
  root.style.colorScheme = palette.code.dark ? "dark" : "light";
  if (palette.code.dark !== titleDark) {
    titleDark = palette.code.dark;
    void getCurrentWindow().setTheme(titleDark ? "dark" : null).catch(() => undefined);
  }
}

export const themesExtension: EditorExtensionFactory = () => themeCompartment.of(themeFor(current));
