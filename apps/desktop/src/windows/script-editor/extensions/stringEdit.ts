import { EditorView, type Tooltip } from "@codemirror/view";
import { checkTextWidth, endsWithBreakControl, wrapStringBody, type TextWidthOptions } from "@zigzagumap/core";
import { jaScriptEditorAssist as t } from "../../../i18n/ja.scriptEditorAssist";
import { errorText } from "../../../util/errors";
import type { EditorExtensionFactory, EditorFileContext } from "./context";
import { setPinnedTooltip } from "./pinned";
import { joinedStringInput as joinedText, normalizeStringInput } from "./stringInput";

/**
 * 文字列の本文のその場編集（#196）。`.s` の文字列の参照のホバーの「本文を編集」から、小さな入力欄を出す。
 * 入力中は文字数で幅を検査し（上限は zigzagumap.json の lineMaxChars・linesPerPage）、超えた行に印を付ける。
 * 「反映」で `.string` のそのラベルの本文だけを書き換える（そのファイルを開いていなければ裏で開き、未保存にする。Ctrl+S で保存）。
 *
 * 複数行（#221）: 本文は制御記号（`\n` `\p` `\l` `\m`）のあとで改行した形で見せ、その形で書き戻す。Enter は改行で、
 * カーソルの前が制御記号でなければ `\n` を補ってから改行する（改行の文字は制御記号のすぐ後ろにしか書けないため）。
 * 反映は Ctrl+Enter か「反映」。貼り付けなどで制御記号の無い改行が入ったときも、反映のときに `\n` を補う。
 */

/** 幅検査の設定（プロジェクトの設定から）。 */
export function widthOptions(ctx: EditorFileContext): TextWidthOptions {
  const c = ctx.project.config;
  return c ? { maxColumns: c.lineMaxChars, maxLines: c.linesPerPage } : {};
}

/** 入力欄の下の、行ごとの字数の表。 */
function renderLines(list: HTMLElement, text: string, options: TextWidthOptions): number {
  const joined = joinedText(text);
  const result = checkTextWidth(joined, options);
  const over = new Set(result.issues.map((i) => `${i.page}:${i.line}`));
  list.replaceChildren(
    ...result.lines.map((l) => {
      const row = document.createElement("div");
      row.className = "se-width-line";
      row.classList.toggle("over", over.has(`${l.page}:${l.line}`));
      row.textContent = `${t.stringEdit.lineInfo(l.page + 1, l.line + 1, l.columns, options.maxColumns ?? 18)}　${joined.slice(l.start, l.end)}`;
      return row;
    }),
  );
  return result.issues.length;
}

/** 入力欄を出す。 */
export function openStringEditor(view: EditorView, ctx: EditorFileContext, label: string, pos: number): void {
  const entry = ctx.project.assist.strings.find(label)[0];
  if (!entry) {
    ctx.host.setMessage(t.stringEdit.notFound(label));
    return;
  }
  const options = widthOptions(ctx);
  const tooltip: Tooltip = {
    pos,
    above: false,
    create: (v) => {
      const dom = document.createElement("div");
      dom.className = "se-string-edit se-pinned";
      dom.dataset["autoId"] = "se.stringEdit";
      const title = document.createElement("div");
      title.className = "se-string-edit-title";
      title.textContent = `${t.stringEdit.title(label)}（${entry.path}:${entry.line}）`;
      const input = document.createElement("textarea");
      input.spellcheck = false;
      input.value = wrapStringBody(entry.text);
      input.rows = Math.min(10, Math.max(3, input.value.split("\n").length + 1));
      input.dataset["autoId"] = "se.stringEdit.input";
      const lines = document.createElement("div");
      lines.className = "se-width-lines";
      lines.dataset["autoId"] = "se.stringEdit.lines";
      const hint = document.createElement("div");
      hint.className = "se-string-edit-hint";
      hint.textContent = t.stringEdit.hint;
      const error = document.createElement("div");
      error.className = "se-string-edit-error";
      const apply = document.createElement("button");
      apply.type = "button";
      apply.textContent = t.stringEdit.apply;
      apply.dataset["autoId"] = "se.stringEdit.apply";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = t.stringEdit.cancel;
      const bar = document.createElement("div");
      bar.className = "se-hover-actions";
      bar.append(apply, cancel);
      dom.append(title, input, lines, hint, error, bar);
      const close = () => {
        v.dispatch({ effects: setPinnedTooltip.of(null) });
        v.focus();
      };
      const run = async () => {
        try {
          const path = await ctx.host.editStringBody(label, normalizeStringInput(input.value));
          if (path === null) error.textContent = t.stringEdit.notFound(label);
          else {
            ctx.host.setMessage(t.stringEdit.applied(label, path));
            close();
          }
        } catch (e) {
          error.textContent = errorText(e);
        }
      };
      input.addEventListener("input", () => renderLines(lines, input.value, options));
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void run();
        } else if (e.key === "Enter" && !e.isComposing) {
          // 改行の文字は制御記号のすぐ後ろにしか書けないので、カーソルの前が制御記号でなければ \n を補う
          e.preventDefault();
          const before = input.value.slice(0, input.selectionStart);
          input.setRangeText(endsWithBreakControl(before) ? "\n" : "\\n\n", input.selectionStart, input.selectionEnd, "end");
          renderLines(lines, input.value, options);
        } else if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      });
      apply.addEventListener("click", () => void run());
      cancel.addEventListener("click", close);
      renderLines(lines, input.value, options);
      return { dom, mount: () => input.focus() };
    },
  };
  view.dispatch({ effects: setPinnedTooltip.of(tooltip) });
}

/** 入力欄の見た目（色はテーマに合わせて、テーマの吹き出しの色を使う）。 */
export const stringEditExtension: EditorExtensionFactory = (ctx) =>
  ctx.kind !== "asm"
    ? []
    : EditorView.baseTheme({
        ".se-string-edit": { padding: "6px 8px", width: "460px" },
        ".se-string-edit textarea": { width: "100%", boxSizing: "border-box", font: "inherit", resize: "vertical" },
        ".se-string-edit-title": { fontWeight: "bold", marginBottom: "4px" },
        ".se-width-line": { whiteSpace: "pre", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis" },
        ".se-width-line.over": { color: "var(--error-text)", fontWeight: "bold" },
        ".se-width-line.over::before": { content: '"▲ "' },
        ".se-string-edit-hint": { fontSize: "11px", opacity: "0.75", marginTop: "4px" },
        ".se-string-edit-error": { color: "var(--error-text)", fontSize: "12px" },
      });
